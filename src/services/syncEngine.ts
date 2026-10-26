import type { SyncRepository } from "./syncRepository";
import type { SyncNative, NativeSyncState } from "./syncNative";
export class SyncEngine {
  constructor(
    private uid: string,
    private repo: SyncRepository,
    private native: SyncNative,
    private assertSession: () => void,
    private changed: () => Promise<void> = async () => {},
  ) {}
  async pass(): Promise<NativeSyncState> {
    this.assertSession();
    let local = await this.native.state();
    const binding = local.binding;
    if (
      !binding ||
      binding.uid !== this.uid ||
      !binding.enabled ||
      binding.conflict
    )
      return local;
    const head = await this.repo.head();
    this.assertSession();
    if (!head || head.spaceId !== binding.spaceId)
      throw new Error("云端厨房与本机连接不一致，请重新连接。");
    for (let rounds = 0; rounds < 20; rounds++) {
      this.assertSession();
      local = await this.native.state();
      if (
        !local.binding ||
        local.binding.uid !== this.uid ||
        !local.binding.enabled ||
        local.binding.conflict
      )
        return local;
      const cursor = local.binding.cursor;
      const operations = await this.repo.operations(cursor);
      this.assertSession();
      for (const operation of operations) {
        if (operation.spaceId !== binding.spaceId)
          throw new Error("远端操作属于不同厨房。");
        const token = await this.native.beginIncoming(this.uid, operation);
        try {
          await this.repo.download(operation, (index, data) => {
            this.assertSession();
            return this.native.acceptChunk(this.uid, token, index, data);
          });
          this.assertSession();
          if (await this.native.finishIncoming(this.uid, token))
            await this.changed();
        } finally {
          await this.native.releaseIncoming(this.uid, token);
        }
      }
      if (operations.length === 50) continue;
      this.assertSession();
      const next = await this.native.outgoing(this.uid);
      if (!next) return this.native.state();
      await this.repo.uploadChunks(next, (index) => {
        this.assertSession();
        return this.native.outgoingChunk(this.uid, next.id, index);
      });
      this.assertSession();
      try {
        const published = await this.repo.publish(next, next.sequence - 1);
        this.assertSession();
        const current = await this.native.state();
        if (current.binding?.cursor === published.sequence - 1) {
          if (await this.native.acknowledge(this.uid, published))
            await this.changed();
        }
      } catch (e) {
        if (!(
          e &&
          typeof e === "object" &&
          "code" in e &&
          e.code === "SYNC_STALE"
        ))
          throw e;
      }
    }
    return this.native.state();
  }
}
