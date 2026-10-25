import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDocFromServer, deleteDoc } from "firebase/firestore";
import {
  CloudRepository,
  type CloudManifest,
  type SnapshotBridge,
} from "../src/services/cloudRepository";

const manifest: CloudManifest = {
  id: "00000000-0000-4000-8000-000000000001",
  formatVersion: 1,
  schemaVersion: 12,
  createdAt: 1792886400,
  sizeBytes: 4,
  sha256: "b".repeat(64),
  includesChat: false,
  chunks: [
    {
      hash: createHash("sha256").update("abcd").digest("hex"),
      compressedBytes: 4,
      rawBytes: 4,
    },
  ],
};
const chunk = { ...manifest.chunks[0], data: "YWJjZA==" };
const bridge = (): SnapshotBridge => ({
  prepare: vi.fn(async () => structuredClone(manifest)),
  read: vi.fn(async () => chunk.data),
  begin: vi.fn(async () => "download-token"),
  accept: vi.fn(async () => {}),
  finish: vi.fn(async () => ({
    token: "restore-token",
    recipes: 1,
    inventoryLots: 0,
    plannedMeals: 0,
    cookingSessions: 0,
    fileName: "云备份",
  })),
  release: vi.fn(async () => {}),
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  "Firebase cloud backups (local emulator only)",
  () => {
    let env: RulesTestEnvironment;
    beforeAll(async () => {
      env = await initializeTestEnvironment({
        projectId: "demo-chefish",
        firestore: { rules: readFileSync("firestore.rules", "utf8") },
      });
    });
    beforeEach(async () => {
      await env.clearFirestore();
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    const db = (uid: string, verified = true) =>
      env.authenticatedContext(uid, { email_verified: verified }).firestore();
    it("verified owners can upload, list, deduplicate and download a completed backup", async () => {
      const store = db("alice");
      const repo = new CloudRepository(store, "alice", () => {});
      const first = bridge();
      await repo.upload(first, () => {});
      expect(first.release).toHaveBeenCalledWith(manifest.id);
      expect(await repo.list()).toEqual([manifest]);
      const retry = bridge();
      await repo.upload(retry, () => {});
      expect(retry.read).not.toHaveBeenCalled();
      expect((await repo.download(manifest, first, () => {})).token).toBe(
        "restore-token",
      );
      expect(first.accept).toHaveBeenCalledWith(
        "download-token",
        0,
        chunk.data,
      );
      expect(first.release).toHaveBeenCalledWith("download-token");
    });
    it("another account, guest and unverified account cannot access an owner's data", async () => {
      await new CloudRepository(db("alice"), "alice", () => {}).upload(
        bridge(),
        () => {},
      );
      for (const store of [
        db("bob"),
        db("alice", false),
        env.unauthenticatedContext().firestore(),
      ]) {
        await assertFails(
          getDocFromServer(doc(store, "users/alice/backups", manifest.id)),
        );
        await assertFails(
          getDocFromServer(doc(store, "users/alice/chunks", chunk.hash)),
        );
        await assertFails(
          setDoc(doc(store, "users/alice/backups", manifest.id), manifest),
        );
      }
      expect(
        await new CloudRepository(db("bob"), "bob", () => {}).list(),
      ).toEqual([]);
    });
    it("published chunks and manifests cannot be altered or deleted", async () => {
      const store = db("alice");
      const ref = doc(store, "users/alice/chunks", chunk.hash);
      const backup = doc(store, "users/alice/backups", manifest.id);
      await assertSucceeds(setDoc(ref, chunk));
      await assertSucceeds(setDoc(backup, manifest));
      await assertSucceeds(setDoc(ref, chunk));
      await assertFails(setDoc(ref, { ...chunk, data: "ZWZnaA==" }));
      await assertFails(
        setDoc(backup, { ...manifest, sha256: "c".repeat(64) }),
      );
      await assertFails(deleteDoc(ref));
      await assertFails(deleteDoc(backup));
    });
    it("accepts both old and current schema backups and rejects future schema", async () => {
      const store = db("alice");
      for (const schemaVersion of [11, 12, 13]) {
        const value = { ...manifest, id: randomUUID(), schemaVersion };
        const write = setDoc(
          doc(store, "users/alice/backups", value.id),
          value,
        );
        if (schemaVersion <= 12) await assertSucceeds(write);
        else await assertFails(write);
      }
    });
    it("rejects oversized, mislabeled, chat-bearing and extra-field documents", async () => {
      const store = db("alice");
      const ref = doc(store, "users/alice/chunks", chunk.hash);
      for (const bad of [
        { ...chunk, hash: "c".repeat(64) },
        { ...chunk, compressedBytes: 270337 },
        { ...chunk, rawBytes: 262145 },
        { ...chunk, data: "bad" },
        { ...chunk, secret: "no" },
      ])
        await assertFails(setDoc(ref, bad));
      const backup = doc(store, "users/alice/backups", manifest.id);
      for (const bad of [
        { ...manifest, includesChat: true },
        { ...manifest, sizeBytes: 536870913 },
        { ...manifest, chunks: [] },
        { ...manifest, id: "different" },
        { ...manifest, secret: "no" },
      ])
        await assertFails(setDoc(backup, bad));
    });
    it("accepts manifests above 128 MiB up to 512 MiB and denies one byte beyond", async () => {
      const store = db("alice");
      for (const sizeBytes of [134217729, 536870912, 536870913]) {
        const value = {
          ...manifest,
          id: randomUUID(),
          sizeBytes,
          chunks: Array.from(
            { length: Math.ceil(sizeBytes / 262144) },
            (_, index) => ({
              ...manifest.chunks[0],
              rawBytes: Math.min(262144, sizeBytes - index * 262144),
            }),
          ),
        };
        const write = setDoc(
          doc(store, "users/alice/backups", value.id),
          value,
        );
        if (sizeBytes <= 536870912) await assertSucceeds(write);
        else await assertFails(write);
      }
    });
    it("interrupted uploads never publish a backup and always release native scratch files", async () => {
      const native = bridge();
      native.read = vi.fn(async () => {
        throw new Error("synthetic failure");
      });
      const repo = new CloudRepository(db("alice"), "alice", () => {});
      await expect(repo.upload(native, () => {})).rejects.toThrow(
        "synthetic failure",
      );
      expect(await repo.list()).toEqual([]);
      expect(native.release).toHaveBeenCalledWith(manifest.id);
    });
    it("session changes stop a transfer before publishing; missing downloads never finish", async () => {
      let active = true;
      const native = bridge();
      native.read = vi.fn(async () => {
        active = false;
        return chunk.data;
      });
      const repo = new CloudRepository(db("alice"), "alice", () => {
        if (!active) throw new Error("session changed");
      });
      await expect(repo.upload(native, () => {})).rejects.toThrow(
        "session changed",
      );
      expect(native.release).toHaveBeenCalledWith(manifest.id);
      const download = bridge();
      await expect(
        new CloudRepository(db("alice"), "alice", () => {}).download(
          manifest,
          download,
          () => {},
        ),
      ).rejects.toThrow("缺少分块");
      expect(download.finish).not.toHaveBeenCalled();
      expect(download.release).toHaveBeenCalledWith("download-token");
    });
  },
);
