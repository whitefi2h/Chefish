import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  runTransaction,
  where,
  type Firestore,
} from "firebase/firestore";
export interface SyncHead {
  formatVersion: 1;
  spaceId: string;
  baselineId: string;
  sequence: number;
  lastOperationId: string;
}
export interface SyncOperation {
  id: string;
  replicaId: string;
  spaceId: string;
  sequence: number;
  formatVersion: number;
  schemaVersion: number;
  sha256: string;
  bytes: number;
  chunks: { hash: string; bytes: number }[];
}
export class SyncStale extends Error {
  readonly code = "SYNC_STALE";
  constructor() {
    super("云端已有新操作，正在重新拉取。");
  }
}
async function verify(
  data: unknown,
  hash: string,
  bytes: number,
): Promise<string> {
  if (typeof data !== "string" || data.length > 349528)
    throw new Error("同步分块大小无效。");
  const binary = Uint8Array.from(atob(data), (v) => v.charCodeAt(0));
  const sha = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", binary)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  if (binary.length !== bytes || sha !== hash)
    throw new Error("云端同步分块校验失败。");
  return data;
}
export class SyncRepository {
  constructor(
    private db: Firestore,
    private uid: string,
    private assertSession: () => void,
  ) {}
  async head(): Promise<SyncHead | null> {
    this.assertSession();
    const row = await getDocFromServer(
      doc(this.db, "users", this.uid, "sync", "head"),
    );
    this.assertSession();
    if (!row.exists()) return null;
    const value = row.data() as SyncHead;
    if (
      value.formatVersion !== 1 ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0 ||
      typeof value.spaceId !== "string" ||
      typeof value.baselineId !== "string"
    )
      throw new Error("云端同步状态无效，请更新程序。");
    return value;
  }
  async create(baselineId: string): Promise<SyncHead> {
    const head: SyncHead = {
      formatVersion: 1,
      spaceId: crypto.randomUUID(),
      baselineId,
      sequence: 0,
      lastOperationId: "",
    };
    const ref = doc(this.db, "users", this.uid, "sync", "head");
    await runTransaction(
      this.db,
      async (tx) => {
        const existing = await tx.get(ref);
        this.assertSession();
        if (existing.exists())
          throw new Error("账户已有云端厨房，请选择连接云端厨房。");
        tx.set(ref, head);
      },
      { maxAttempts: 3 },
    );
    this.assertSession();
    return head;
  }
  async operations(after: number): Promise<SyncOperation[]> {
    this.assertSession();
    const rows = await getDocsFromServer(
      query(
        collection(this.db, "users", this.uid, "sync_operations"),
        where("sequence", ">", after),
        orderBy("sequence"),
        limit(50),
      ),
    );
    this.assertSession();
    return rows.docs.map(
      (row) => ({ ...row.data(), id: row.id }) as SyncOperation,
    );
  }
  async uploadChunks(
    operation: SyncOperation,
    read: (index: number) => Promise<string>,
  ) {
    for (let index = 0; index < operation.chunks.length; index++) {
      this.assertSession();
      const chunk = operation.chunks[index];
      const ref = doc(this.db, "users", this.uid, "sync_blobs", chunk.hash);
      const existing = await getDocFromServer(ref);
      this.assertSession();
      if (existing.exists()) {
        if (existing.data().bytes !== chunk.bytes)
          throw new Error("同步分块长度不匹配。");
        await verify(existing.data().data, chunk.hash, chunk.bytes);
        continue;
      }
      const data = await read(index);
      await verify(data, chunk.hash, chunk.bytes);
      this.assertSession();
      await runTransaction(
        this.db,
        async (tx) => {
          await tx.get(ref);
          this.assertSession();
          tx.set(ref, { hash: chunk.hash, bytes: chunk.bytes, data });
        },
        { maxAttempts: 3 },
      );
    }
  }
  async publish(
    operation: SyncOperation,
    expected: number,
  ): Promise<SyncOperation> {
    this.assertSession();
    const headRef = doc(this.db, "users", this.uid, "sync", "head"),
      opRef = doc(this.db, "users", this.uid, "sync_operations", operation.id);
    const committed = await runTransaction(
      this.db,
      async (tx) => {
        const head = await tx.get(headRef);
        const prior = await tx.get(opRef);
        this.assertSession();
        if (prior.exists()) {
          const existing = prior.data() as SyncOperation;
          if (
            existing.sha256 !== operation.sha256 ||
            existing.spaceId !== operation.spaceId ||
            existing.replicaId !== operation.replicaId
          )
            throw new Error("同一操作的云端内容发生变化。");
          return existing;
        }
        const state = head.data() as SyncHead | undefined;
        if (
          !state ||
          state.spaceId !== operation.spaceId ||
          state.sequence !== expected
        )
          throw new SyncStale();
        const value = { ...operation, sequence: expected + 1 };
        tx.set(opRef, value);
        tx.update(headRef, {
          sequence: value.sequence,
          lastOperationId: value.id,
        });
        return value;
      },
      { maxAttempts: 3 },
    ).catch(async (error: unknown) => {
      // Rules can reject a stale transaction before Firestore evaluates its
      // version precondition. Retry only after confirming an advanced head.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "permission-denied"
      ) {
        const latest = await this.head();
        if (latest?.spaceId === operation.spaceId && latest.sequence > expected)
          throw new SyncStale();
      }
      throw error;
    });
    this.assertSession();
    return committed;
  }
  async download(
    operation: SyncOperation,
    accept: (index: number, data: string) => Promise<void>,
  ) {
    if (!Array.isArray(operation.chunks) || operation.chunks.length > 2048)
      throw new Error("同步清单超出大小限制。");
    for (let index = 0; index < operation.chunks.length; index++) {
      this.assertSession();
      const reference = operation.chunks[index];
      const row = await getDocFromServer(
        doc(this.db, "users", this.uid, "sync_blobs", reference.hash),
      );
      this.assertSession();
      if (!row.exists()) throw new Error("同步操作缺少分块，请稍后重试。");
      const value = row.data();
      if (value.bytes !== reference.bytes)
        throw new Error("同步分块长度不匹配。");
      await accept(
        index,
        await verify(value.data, reference.hash, reference.bytes),
      );
    }
  }
}
