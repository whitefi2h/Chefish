import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDocFromServer,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import {
  SyncRepository,
  type SyncOperation,
} from "../src/services/syncRepository";
import { SyncEngine } from "../src/services/syncEngine";
import { CloudRepository } from "../src/services/cloudRepository";
import { baselineBridge, type SyncNative } from "../src/services/syncNative";
import { NativeReplica } from "./helpers/nativeReplica";

const sha = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const fixture = () => {
  const data = Buffer.from("synthetic operation");
  return {
    id: randomUUID(),
    replicaId: randomUUID(),
    spaceId: randomUUID(),
    sequence: 1,
    formatVersion: 1,
    schemaVersion: 15,
    sha256: sha(data),
    bytes: data.length,
    chunks: [{ hash: sha(data), bytes: data.length }],
  } satisfies SyncOperation;
};
const baseline = () => ({
  id: randomUUID(),
  formatVersion: 1,
  schemaVersion: 15,
  createdAt: Math.floor(Date.now() / 1000),
  sizeBytes: 1,
  sha256: "a".repeat(64),
  includesChat: false,
  chunks: [{ hash: "b".repeat(64), compressedBytes: 1, rawBytes: 1 }],
});

const receive = (name: string) => ({
  type: "receive_lot",
  draft: {
    name,
    category: "未分类",
    quantity: "5",
    unit: "个",
    location: "冷藏",
    received: "2026-10-25",
    expires: null,
    precision: "rough",
  },
});
const recipe = (name: string) => ({
  type: "create_recipe",
  draft: {
    name,
    category: "家常菜",
    minutes: 10,
    servings: 2,
    subtitle: "",
    seasoning: "",
    ingredients: [],
    steps: ["洗净"],
    media: {
      cover: "data:image/png;base64,iVBORw0KGgo=",
      steps: [{ image: "data:image/png;base64,iVBORw0KGgo=", sourceStep: 1 }],
    },
  },
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  "ordered multi-device sync",
  () => {
    let env: RulesTestEnvironment;
    beforeAll(async () => {
      env = await initializeTestEnvironment({
        projectId: "demo-chefish-sync",
        firestore: { rules: readFileSync("firestore.rules", "utf8") },
      });
    });
    beforeEach(async () => {
      await env.clearFirestore();
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    const store = (uid = "alice", verified = true) =>
      env.authenticatedContext(uid, { email_verified: verified }).firestore();
    async function setup() {
      const db = store();
      const seed = baseline();
      await setDoc(doc(db, "users/alice/backups", seed.id), seed);
      const repo = new SyncRepository(db, "alice", () => {});
      const head = await repo.create(seed.id);
      return { db, repo, head };
    }
    it("publishes an operation and advances the head atomically, retrying exactly once", async () => {
      const { repo, head } = await setup();
      const op = { ...fixture(), spaceId: head.spaceId };
      await repo.uploadChunks(op, async () =>
        Buffer.from("synthetic operation").toString("base64"),
      );
      expect(await repo.publish(op, 0)).toEqual(op);
      expect(await repo.publish(op, 0)).toEqual(op);
      expect((await repo.head())?.sequence).toBe(1);
      expect(await repo.operations(0)).toEqual([op]);
      await expect(
        repo.publish({ ...fixture(), spaceId: head.spaceId }, 0),
      ).rejects.toMatchObject({ code: "SYNC_STALE" });
    });
    it("rejects missing baseline, standalone cursor jumps, orphan operations and mutable history", async () => {
      const db = store();
      await assertFails(
        new SyncRepository(db, "alice", () => {}).create(randomUUID()),
      );
      const { repo, head } = await setup();
      const op = { ...fixture(), spaceId: head.spaceId };
      await assertFails(
        setDoc(doc(db, "users/alice/sync_operations", op.id), op),
      );
      await assertFails(
        setDoc(doc(db, "users/alice/sync/head"), {
          ...head,
          sequence: 1,
          lastOperationId: op.id,
        }),
      );
      const batch = writeBatch(db);
      batch.set(doc(db, "users/alice/sync_operations", op.id), {
        ...op,
        sequence: 2,
      });
      batch.set(doc(db, "users/alice/sync/head"), {
        ...head,
        sequence: 2,
        lastOperationId: op.id,
      });
      await assertFails(batch.commit());
      await repo.publish(op, 0);
      await assertFails(
        setDoc(doc(db, "users/alice/sync_operations", op.id), {
          ...op,
          bytes: 1,
        }),
      );
      await assertFails(deleteDoc(doc(db, "users/alice/sync/head")));
    });
    it("isolates verified accounts, validates chunk limits and detects corrupt cloud bytes", async () => {
      const { repo, head } = await setup();
      const op = { ...fixture(), spaceId: head.spaceId };
      await repo.publish(op, 0);
      for (const db of [
        store("bob"),
        store("alice", false),
        env.unauthenticatedContext().firestore(),
      ])
        await assertFails(getDocFromServer(doc(db, "users/alice/sync/head")));
      const db = store();
      const ref = doc(db, "users/alice/sync_blobs", op.sha256);
      await assertFails(
        setDoc(ref, { hash: op.sha256, bytes: 262145, data: "YQ==" }),
      );
      await setDoc(ref, {
        hash: op.sha256,
        bytes: op.bytes,
        data: Buffer.from("a".repeat(op.bytes)).toString("base64"),
      });
      await expect(repo.download(op, async () => {})).rejects.toThrow(
        "校验失败",
      );
    });
    it("replaces a baseline atomically, keeps its recovery record and refuses stale replacements", async () => {
      const { repo, head, db } = await setup();
      const seed = baseline();
      await setDoc(doc(db, "users/alice/backups", seed.id), seed);
      await assertFails(
        setDoc(doc(db, "users/alice/sync/head"), {
          ...head,
          spaceId: randomUUID(),
          baselineId: seed.id,
          baselineSequence: 0,
        }),
      );
      const replacement = await repo.replace(seed.id, head);
      expect(replacement.sequence).toBe(head.sequence);
      expect(replacement.baselineSequence).toBe(head.sequence);
      expect(
        (
          await getDocFromServer(
            doc(db, "users/alice/sync_versions", replacement.spaceId),
          )
        ).data(),
      ).toEqual(head);
      const nextSeed = baseline();
      await setDoc(doc(db, "users/alice/backups", nextSeed.id), nextSeed);
      await expect(repo.replace(nextSeed.id, head)).rejects.toThrow("已变化");
      await assertFails(
        deleteDoc(doc(db, "users/alice/sync_versions", replacement.spaceId)),
      );
      const op = { ...fixture(), spaceId: replacement.spaceId };
      await repo.publish(op, replacement.sequence);
      expect((await repo.head())?.sequence).toBe(replacement.sequence + 1);
    });
    it.skipIf(process.env.CHEFISH_NATIVE_SYNC_TEST !== "1")(
      "full replacement bypasses a stuck 135-operation queue, preserves edits during upload and reconnects another native device",
      async () => {
        const a = new NativeReplica(),
          b = new NativeReplica();
        await Promise.all([a.ready, b.ready]);
        try {
          await a.execute(receive("鸡蛋"));
          await a.execute(recipe("完整版本中的菜谱图片"));
          const an = a.bridge(),
            bn = b.bridge();
          const db = store();
          const repo = new SyncRepository(db, "alice", () => {});
          const backups = new CloudRepository(db, "alice", () => {});
          const seed = await an.prepareBaseline(
            "alice",
            "synthetic@example.invalid",
            false,
          );
          await backups.upload(
            baselineBridge(an, seed, a.download()),
            () => {},
          );
          const initial = await repo.create(seed.manifest.id);
          await an.bindBaseline("alice", seed.manifest.id, initial.spaceId);
          const first = await backups.download(
            seed.manifest,
            b.download(),
            () => {},
          );
          await bn.connect(
            "alice",
            "synthetic@example.invalid",
            initial.spaceId,
            first.token,
          );
          const engine = (native: SyncNative) =>
            new SyncEngine("alice", repo, native, () => {});
          await a.execute({
            type: "save_shopping_memo",
            expected_revision: (await a.snapshot()).dataRevision,
            memo: "原云端版本",
          });
          await engine(an).pass();
          for (let i = 0; i < 135; i++)
            await b.execute({
              type: "save_shopping_memo",
              expected_revision: (await b.snapshot()).dataRevision,
              memo: `本机备忘${i}`,
            });
          await b.call("legacyConflict");
          expect((await bn.state()).queuedOperations).toBe(135);
          // Ordinary retry cannot undo the obsolete local baseline.
          await bn.retry("alice");
          await expect(engine(bn).pass()).rejects.toMatchObject({
            code: "SYNC_CONFLICT",
          });
          const expected = (await repo.head())!;
          const replacement = await bn.prepareReplacement(
            "alice",
            "synthetic@example.invalid",
          );
          expect(await b.call<number>("backupCount")).toBeGreaterThan(0);
          await backups.upload(
            baselineBridge(bn, replacement, b.download()),
            () => {},
          );
          await b.execute(receive("上传期间新增"));
          const replaced = await repo.replace(
            replacement.manifest.id,
            expected,
          );
          await bn.bindBaseline(
            "alice",
            replacement.manifest.id,
            replaced.spaceId,
            replaced.baselineSequence,
          );
          expect((await bn.state()).queuedOperations).toBe(1);
          expect((await bn.state()).binding?.conflict).toBeNull();
          await a.execute({
            type: "save_shopping_memo",
            expected_revision: (await a.snapshot()).dataRevision,
            memo: "其他设备旧修改",
          });
          await a.call("legacyConflict");
          await an.retry("alice");
          await expect(engine(an).pass()).rejects.toThrow(
            "云端同步版本已被替换",
          );
          const restore = await backups.download(
            await backups.get(replaced.baselineId),
            a.download(),
            () => {},
          );
          await an.connect(
            "alice",
            "synthetic@example.invalid",
            replaced.spaceId,
            restore.token,
            replaced.baselineSequence,
          );
          expect(await a.call<number>("backupCount")).toBeGreaterThan(0);
          expect((await an.state()).queuedOperations).toBe(0);
          expect((await a.snapshot()).memo).toBe("当前本机完整备忘");
          await engine(bn).pass();
          await engine(an).pass();
          expect((await a.snapshot()).lots).toEqual((await b.snapshot()).lots);
          expect((await a.snapshot()).recipes).toEqual(
            (await b.snapshot()).recipes,
          );
          expect((await an.state()).binding?.cursor).toBe(
            replaced.sequence + 1,
          );
          expect((await bn.state()).queuedOperations).toBe(0);
        } finally {
          await Promise.all([a.close(), b.close()]);
        }
      },
      120000,
    );
    it.skipIf(process.env.CHEFISH_NATIVE_SYNC_TEST !== "1")(
      "two isolated native SQLite replicas sync baseline/images, concurrent offline edits, restart, lost acknowledgement and automatic same-record merge",
      async () => {
        const a = new NativeReplica(),
          b = new NativeReplica();
        await Promise.all([a.ready, b.ready]);
        try {
          await a.execute(receive("鸡蛋"));
          await a.execute(recipe("初始配方"));
          await b.execute(receive("连接前库存"));
          const an = a.bridge(),
            bn = b.bridge();
          const db = store();
          const repo = new SyncRepository(db, "alice", () => {});
          const backups = new CloudRepository(db, "alice", () => {});
          const seed = await an.prepareBaseline(
            "alice",
            "synthetic@example.invalid",
            false,
          );
          await backups.upload(
            baselineBridge(an, seed, a.download()),
            () => {},
          );
          const head = await repo.create(seed.manifest.id);
          await an.bindBaseline("alice", seed.manifest.id, head.spaceId);
          const preview = await backups.download(
            await backups.get(head.baselineId),
            b.download(),
            () => {},
          );
          await bn.connect(
            "alice",
            "synthetic@example.invalid",
            head.spaceId,
            preview.token,
          );
          expect((await b.snapshot()).recipes).toEqual(
            (await a.snapshot()).recipes,
          );
          const engine = (native: SyncNative) =>
            new SyncEngine("alice", repo, native, () => {});
          await a.call("preferences", {
            value: { taste: "清淡", equipment: "电炒锅" },
          });
          await b.call("preferences", {
            value: { taste: "家常", restrictions: "不吃香菜" },
          });
          await b.execute(receive("偏好合并时仍应保留的库存"));
          await engine(an).pass();
          await engine(bn).pass();
          await engine(an).pass();
          expect(await a.call("preferences")).toEqual(
            await b.call("preferences"),
          );
          expect(await b.call("preferences")).toMatchObject({
            taste: "家常",
            restrictions: "不吃香菜",
            equipment: "电炒锅",
          });
          expect((await a.snapshot()).lots).toEqual((await b.snapshot()).lots);
          await a.execute(recipe("断网新增配方与图片"));
          await b.execute(receive("香蕉"));
          await b.call("restart");
          await Promise.all([engine(an).pass(), engine(bn).pass()]);
          await engine(an).pass();
          await engine(bn).pass();
          expect((await a.snapshot()).lots).toEqual((await b.snapshot()).lots);
          expect((await b.snapshot()).recipes).toEqual(
            (await a.snapshot()).recipes,
          );
          expect((await bn.state()).queuedOperations).toBe(0);
          expect((await an.state()).queuedOperations).toBe(0);
          await a.execute(receive("丢失确认测试"));
          const op = (await an.outgoing("alice"))!;
          await repo.uploadChunks(op, (index) =>
            an.outgoingChunk("alice", op.id, index),
          );
          await repo.publish(op, op.sequence - 1);
          // Cloud commit succeeded but the device never received its acknowledgement.
          await a.call("restart");
          await engine(an).pass();
          await engine(bn).pass();
          expect((await an.state()).queuedOperations).toBe(0);
          expect((await a.snapshot()).lots).toEqual((await b.snapshot()).lots);
          const lot = (await a.snapshot()).lots[0];
          for (const [native, amount] of [
            [a, "1"],
            [b, "2"],
          ] as const)
            await native.execute({
              type: "change_lot",
              lot_id: lot.id,
              expected_version: lot.version,
              operation: "use",
              quantity: amount,
              location: null,
              reason: "",
            });
          await engine(an).pass();
          await engine(bn).pass();
          await b.call("restart");
          await engine(an).pass();
          expect((await a.snapshot()).lots).toEqual((await b.snapshot()).lots);
          expect((await bn.state()).queuedOperations).toBe(0);
          expect((await bn.state()).binding?.conflict).toBeNull();
          await expect(bn.outgoing("bob")).rejects.toMatchObject({
            code: "SYNC_ACCOUNT",
          });
        } finally {
          await Promise.all([a.close(), b.close()]);
        }
      },
      120000,
    );
  },
);
