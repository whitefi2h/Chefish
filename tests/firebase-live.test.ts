import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { initializeApp, deleteApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  doc,
  getDocFromServer,
  initializeFirestore,
  terminate,
} from "firebase/firestore";
import {
  CloudRepository,
  type CloudManifest,
  type SnapshotBridge,
} from "../src/services/cloudRepository";
import { NativeReplica } from "./helpers/nativeReplica";
import { baselineBridge } from "../src/services/syncNative";
import { SyncRepository } from "../src/services/syncRepository";
import { SyncEngine } from "../src/services/syncEngine";

// Explicit opt-in: creates only synthetic accounts/data in the named Chefish
// project, then removes exactly those generated IDs. Never reads a kitchen DB.
it.skipIf(process.env.CHEFISH_LIVE_CLOUD_TEST !== "1")(
  "real Chefish Auth and Firestore isolate accounts and roundtrip a synthetic backup",
  async () => {
    if (
      process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST
    )
      throw new Error("Live check cannot use emulator hosts");
    const project = "chefish-kitchen";
    const env = Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
    expect(env.VITE_FIREBASE_PROJECT_ID).toBe(project);
    const require = createRequire(import.meta.url);
    const cli = "../node_modules/firebase-tools/lib/";
    const account = require(cli + "auth.js").getGlobalDefaultAccount();
    await require(cli + "requireAuth.js").requireAuth({ project, ...account });
    const { Client } = require(cli + "apiv2.js");
    const adminAuth = new Client({
      urlPrefix: "https://identitytoolkit.googleapis.com",
      auth: true,
    });
    const adminDb = new Client({
      urlPrefix: "https://firestore.googleapis.com",
      auth: true,
    });
    const app = initializeApp(
      {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: project,
        appId: env.VITE_FIREBASE_APP_ID,
      },
      "live-check-" + randomUUID(),
    );
    const auth = getAuth(app);
    const db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    });
    const users: string[] = [];
    const documents: string[] = [];
    const raw = Buffer.from(
      "Chefish synthetic cloud roundtrip fixture " + randomUUID(),
    );
    const compressed = gzipSync(raw);
    const hash = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex");
    const manifest: CloudManifest = {
      id: randomUUID(),
      formatVersion: 1,
      schemaVersion: 13,
      createdAt: Math.floor(Date.now() / 1000),
      sizeBytes: raw.length,
      sha256: hash(raw),
      includesChat: false,
      chunks: [
        {
          hash: hash(compressed),
          compressedBytes: compressed.length,
          rawBytes: raw.length,
        },
      ],
    };
    let downloaded: Buffer | undefined;
    let reads = 0;
    const bridge: SnapshotBridge = {
      prepare: async () => manifest,
      read: async () => {
        reads++;
        return compressed.toString("base64");
      },
      begin: async (value) => {
        expect(value).toEqual(manifest);
        return "synthetic-download";
      },
      accept: async (_token, index, value) => {
        expect(index).toBe(0);
        const bytes = Buffer.from(value, "base64");
        expect(hash(bytes)).toBe(manifest.chunks[0].hash);
        downloaded = gunzipSync(bytes);
      },
      finish: async () => {
        expect(downloaded).toEqual(raw);
        expect(hash(downloaded!)).toBe(manifest.sha256);
        return {
          token: "synthetic-preview",
          recipes: 0,
          inventoryLots: 0,
          plannedMeals: 0,
          cookingSessions: 0,
          fileName: "Synthetic transport fixture",
        };
      },
      release: async () => {},
    };
    try {
      const email = `chefish-check-${randomUUID()}@example.invalid`;
      const password = randomUUID() + "Aa1!";
      const first = (
        await createUserWithEmailAndPassword(auth, email, password)
      ).user;
      users.push(first.uid);
      const makeRepo = () =>
        new CloudRepository(db, first.uid, () => {
          if (auth.currentUser?.uid !== first.uid)
            throw new Error("Session changed");
        });
      await expect(makeRepo().list()).rejects.toMatchObject({
        code: "permission-denied",
      });
      // No email is sent: admin verifies this generated test identity only.
      await adminAuth.post("/v1/accounts:update", {
        targetProjectId: project,
        localId: first.uid,
        emailVerified: true,
      });
      await signOut(auth);
      await signInWithEmailAndPassword(auth, email, password);
      expect(auth.currentUser?.emailVerified).toBe(true);
      documents.push(
        `users/${first.uid}/chunks/${manifest.chunks[0].hash}`,
        `users/${first.uid}/backups/${manifest.id}`,
      );
      const repo = makeRepo();
      await repo.upload(bridge, () => {});
      expect(await repo.list()).toEqual([manifest]);
      await repo.upload(bridge, () => {});
      expect(reads).toBe(1);
      expect((await repo.download(manifest, bridge, () => {})).token).toBe(
        "synthetic-preview",
      );
      if (process.env.CHEFISH_NATIVE_SYNC_TEST === "1") {
        const a = new NativeReplica(),
          b = new NativeReplica();
        try {
          await Promise.all([a.ready, b.ready]);
          await a.execute({
            type: "receive_lot",
            draft: {
              name: "基线测试库存",
              category: "未分类",
              quantity: "2",
              unit: "个",
              location: "冷藏",
              received: "2026-10-26",
              expires: null,
              precision: "rough",
            },
          });
          await a.execute({
            type: "create_recipe",
            draft: {
              name: "真实云端合成测试",
              category: "家常菜",
              minutes: 10,
              servings: 2,
              subtitle: "",
              seasoning: "",
              ingredients: [],
              steps: ["测试步骤"],
              media: {
                cover: "data:image/png;base64,iVBORw0KGgo=",
                steps: [
                  {
                    image: "data:image/png;base64,iVBORw0KGgo=",
                    sourceStep: 1,
                  },
                ],
              },
            },
          });
          const an = a.bridge(),
            bn = b.bridge();
          const seed = await an.prepareBaseline(first.uid, email, false);
          documents.push(
            `users/${first.uid}/backups/${seed.manifest.id}`,
            ...seed.manifest.chunks.map(
              (chunk) => `users/${first.uid}/chunks/${chunk.hash}`,
            ),
            `users/${first.uid}/sync/head`,
          );
          await repo.upload(baselineBridge(an, seed, a.download()), () => {});
          const sync = new SyncRepository(db, first.uid, () => {
            if (auth.currentUser?.uid !== first.uid)
              throw new Error("Session changed");
          });
          const head = await sync.create(seed.manifest.id);
          await an.bindBaseline(first.uid, seed.manifest.id, head.spaceId);
          const preview = await repo.download(
            seed.manifest,
            b.download(),
            () => {},
          );
          await bn.connect(first.uid, email, head.spaceId, preview.token);
          for (const [replica, name] of [
            [a, "真实云端测试苹果"],
            [b, "真实云端测试香蕉"],
          ] as const) {
            await replica.execute({
              type: "receive_lot",
              draft: {
                name,
                category: "未分类",
                quantity: "2",
                unit: "个",
                location: "冷藏",
                received: "2026-10-26",
                expires: null,
                precision: "rough",
              },
            });
            const operation = (await replica.bridge().outgoing(first.uid))!;
            documents.push(
              `users/${first.uid}/sync_operations/${operation.id}`,
              ...operation.chunks.map(
                (chunk) => `users/${first.uid}/sync_blobs/${chunk.hash}`,
              ),
            );
          }
          const ae = new SyncEngine(first.uid, sync, an, () => {}),
            be = new SyncEngine(first.uid, sync, bn, () => {});
          await ae.pass();
          await be.pass();
          await ae.pass();
          expect((await a.snapshot()).lots).toEqual((await b.snapshot()).lots);
          expect((await b.snapshot()).recipes).toEqual(
            (await a.snapshot()).recipes,
          );
          expect((await an.state()).queuedOperations).toBe(0);
          expect((await bn.state()).queuedOperations).toBe(0);
          expect((await sync.head())?.sequence).toBe(2);
        } finally {
          await Promise.all([a.close(), b.close()]);
        }
      }
      await signOut(auth);
      const second = (
        await createUserWithEmailAndPassword(
          auth,
          `chefish-check-${randomUUID()}@example.invalid`,
          randomUUID() + "Aa1!",
        )
      ).user;
      users.push(second.uid);
      await adminAuth.post("/v1/accounts:update", {
        targetProjectId: project,
        localId: second.uid,
        emailVerified: true,
      });
      await second.getIdToken(true);
      await expect(
        getDocFromServer(doc(db, "users", first.uid, "backups", manifest.id)),
      ).rejects.toMatchObject({ code: "permission-denied" });
      await signOut(auth);
      await expect(
        getDocFromServer(doc(db, "users", first.uid, "backups", manifest.id)),
      ).rejects.toMatchObject({ code: "permission-denied" });
    } finally {
      await terminate(db);
      await deleteApp(app);
      const cleanupErrors: string[] = [];
      for (const path of documents) {
        try {
          await adminDb.delete(
            `/v1/projects/${project}/databases/(default)/documents/${path}`,
          );
        } catch {
          cleanupErrors.push("synthetic document cleanup failed");
        }
      }
      for (const uid of users) {
        try {
          await adminAuth.post("/v1/accounts:delete", {
            targetProjectId: project,
            localId: uid,
          });
        } catch {
          cleanupErrors.push("synthetic account cleanup failed");
        }
      }
      expect(cleanupErrors).toEqual([]);
    }
  },
  120000,
);
