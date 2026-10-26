import { readdirSync, statSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { SnapshotBridge } from "../../src/services/cloudRepository";
import type {
  SyncNative,
  NativeSyncState,
  Baseline,
} from "../../src/services/syncNative";
import type { DemoState } from "../../src/model";
export class NativeReplica {
  process: ChildProcessWithoutNullStreams;
  private pending: ((value: {
    value?: unknown;
    error?: unknown;
    ready?: boolean;
  }) => void)[] = [];
  private failures: ((error: Error) => void)[] = [];
  readonly ready: Promise<void>;
  constructor() {
    const dir = "src-tauri/target/debug/deps";
    const name = readdirSync(dir)
      .filter((n) => /^chefish-[0-9a-f]+\.exe$/.test(n))
      .sort(
        (a, b) =>
          statSync(`${dir}/${b}`).mtimeMs - statSync(`${dir}/${a}`).mtimeMs,
      )[0];
    if (!name)
      throw new Error(
        "Build native tests first: cargo test --manifest-path src-tauri/Cargo.toml --no-run",
      );
    this.process = spawn(
      resolve(dir, name),
      ["--exact", "db::replication::tests::bridge", "--ignored", "--nocapture"],
      { env: { ...process.env, CHEFISH_NATIVE_SYNC_TEST: "1" } },
    );
    this.ready = new Promise((done, reject) => {
      this.pending.push((value) => {
        if (value.ready) done();
        else reject(new Error("Native bridge startup failed"));
      });
      this.failures.push(reject);
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      if (line.startsWith("CHEFISH_SYNC:")) {
        this.failures.shift();
        this.pending.shift()?.(JSON.parse(line.slice(13)));
      }
    });
    let stderr = "";
    this.process.stderr.on("data", (data) => {
      stderr += String(data);
    });
    this.process.on("exit", (code) => {
      for (const fail of this.failures)
        fail(new Error(`Native bridge exited ${code}: ${stderr}`));
      this.failures = [];
    });
  }
  async call<T = void>(
    action: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    await this.ready;
    return new Promise((done, reject) => {
      this.failures.push(reject);
      this.pending.push((result) =>
        result.error ? reject(result.error) : done(result.value as T),
      );
      this.process.stdin.write(JSON.stringify({ action, ...args }) + "\n");
    });
  }
  async close() {
    await this.ready;
    this.process.stdin.write("quit\n");
    await new Promise<void>((done) => this.process.once("exit", () => done()));
  }
  bridge(): SyncNative {
    return {
      state: () => this.call<NativeSyncState>("state"),
      pause: (uid, enabled) => this.call("pause", { uid, enabled }),
      prepareBaseline: (uid) => this.call<Baseline>("baseline", { uid }),
      baselineChunk: (token, index) =>
        this.call<string>("baselineChunk", { token, index }),
      releaseBaseline: async () => {},
      bindBaseline: (uid, token, spaceId) =>
        this.call("bindBaseline", { uid, token, spaceId }),
      connect: (uid, _email, spaceId, token) =>
        this.call("connect", { uid, spaceId, token }),
      outgoing: (uid) => this.call("outgoing", { uid }),
      outgoingChunk: (uid, operationId, index) =>
        this.call("outgoingChunk", { uid, operationId, index }),
      beginIncoming: (uid, operation) =>
        this.call("beginIncoming", { uid, operation }),
      acceptChunk: (uid, token, index, data) =>
        this.call("acceptChunk", { uid, token, index, data }),
      finishIncoming: (uid, token) =>
        this.call("finishIncoming", { uid, token }),
      releaseIncoming: (uid, token) =>
        this.call("releaseIncoming", { uid, token }),
      acknowledge: (uid, operation) =>
        this.call("acknowledge", { uid, operation }),
      resolveCloud: (uid) => this.call("resolveCloud", { uid }),
    };
  }
  download(): SnapshotBridge {
    return {
      prepare: async () => {
        throw new Error("Download only");
      },
      read: async () => {
        throw new Error("Download only");
      },
      begin: (manifest) => this.call("downloadBegin", { manifest }),
      accept: (token, index, data) =>
        this.call("downloadChunk", { token, index, data }),
      finish: (token) => this.call("downloadFinish", { token }),
      release: async () => {},
    };
  }
  execute(command: unknown) {
    return this.call("execute", { id: randomUUID(), command });
  }
  snapshot() {
    return this.call<DemoState>("snapshot");
  }
}
