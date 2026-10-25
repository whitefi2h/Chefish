import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  runTransaction,
  type Firestore,
} from "firebase/firestore";

async function verifyExistingChunk(
  value: Record<string, unknown>,
  reference: CloudManifest["chunks"][number],
) {
  if (
    value.compressedBytes !== reference.compressedBytes ||
    value.rawBytes !== reference.rawBytes ||
    typeof value.data !== "string" ||
    value.data.length > 360448
  )
    throw new Error("云备份分块信息不一致，请保留本机备份并联系维护者。");
  const bytes = Uint8Array.from(atob(value.data), (c) => c.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (bytes.length !== reference.compressedBytes || hash !== reference.hash)
    throw new Error("云端已有分块校验失败，本次备份未发布。");
}

export interface CloudManifest {
  id: string;
  formatVersion: number;
  schemaVersion: number;
  createdAt: number;
  sizeBytes: number;
  sha256: string;
  includesChat: false;
  chunks: { hash: string; compressedBytes: number; rawBytes: number }[];
}
export interface RestorePreview {
  token: string;
  recipes: number;
  inventoryLots: number;
  plannedMeals: number;
  cookingSessions: number;
  fileName: string;
}
export interface SnapshotBridge {
  prepare(): Promise<CloudManifest>;
  read(token: string, index: number): Promise<string>;
  begin(manifest: CloudManifest): Promise<string>;
  accept(token: string, index: number, data: string): Promise<void>;
  finish(token: string): Promise<RestorePreview>;
  release(token: string): Promise<void>;
}

// A manifest is the commit marker. Interrupted uploads leave no restorable backup;
// immutable content hashes let retries and later backups reuse completed chunks.
export class CloudRepository {
  constructor(
    private db: Firestore,
    private uid: string,
    private assertSession: () => void,
  ) {}
  async list(): Promise<CloudManifest[]> {
    this.assertSession();
    const rows = await getDocsFromServer(
      query(
        collection(this.db, "users", this.uid, "backups"),
        orderBy("createdAt", "desc"),
        limit(20),
      ),
    );
    this.assertSession();
    return rows.docs.map(
      (row) => ({ ...row.data(), id: row.id }) as CloudManifest,
    );
  }
  async upload(bridge: SnapshotBridge, progress: (value: string) => void) {
    this.assertSession();
    progress("正在准备厨房快照…");
    const manifest = await bridge.prepare();
    try {
      for (let index = 0; index < manifest.chunks.length; index++) {
        this.assertSession();
        progress(`正在上传 ${index + 1} / ${manifest.chunks.length}…`);
        const chunk = manifest.chunks[index];
        const ref = doc(this.db, "users", this.uid, "chunks", chunk.hash);
        const existing = await getDocFromServer(ref);
        this.assertSession();
        if (!existing.exists()) {
          const data = await bridge.read(manifest.id, index);
          this.assertSession();
          // Transactions fail offline rather than queueing a later silent upload.
          await runTransaction(
            this.db,
            async (transaction) => {
              await transaction.get(ref);
              this.assertSession();
              transaction.set(ref, { ...chunk, data });
            },
            { maxAttempts: 3 },
          );
        } else await verifyExistingChunk(existing.data(), chunk);
      }
      this.assertSession();
      const ref = doc(this.db, "users", this.uid, "backups", manifest.id);
      await runTransaction(
        this.db,
        async (transaction) => {
          await transaction.get(ref);
          this.assertSession();
          transaction.set(ref, manifest);
        },
        { maxAttempts: 3 },
      );
      this.assertSession();
      return manifest;
    } finally {
      await bridge.release(manifest.id);
    }
  }
  async download(
    manifest: CloudManifest,
    bridge: SnapshotBridge,
    progress: (value: string) => void,
  ) {
    this.assertSession();
    const token = await bridge.begin(manifest);
    try {
      for (let index = 0; index < manifest.chunks.length; index++) {
        this.assertSession();
        progress(`正在下载 ${index + 1} / ${manifest.chunks.length}…`);
        const chunk = await getDocFromServer(
          doc(
            this.db,
            "users",
            this.uid,
            "chunks",
            manifest.chunks[index].hash,
          ),
        );
        this.assertSession();
        if (!chunk.exists() || typeof chunk.data().data !== "string")
          throw new Error("云备份缺少分块，当前数据未修改。");
        await bridge.accept(token, index, chunk.data().data);
      }
      this.assertSession();
      progress("正在检查备份完整性…");
      return await bridge.finish(token);
    } finally {
      await bridge.release(token);
    }
  }
}
