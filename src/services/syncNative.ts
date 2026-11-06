import { invoke } from "@tauri-apps/api/core";
import type {
  CloudManifest,
  RestorePreview,
  SnapshotBridge,
} from "./cloudRepository";
import type { SyncOperation } from "./syncRepository";
export interface SyncBinding {
  uid: string;
  email: string;
  spaceId: string;
  cursor: number;
  enabled: boolean;
  conflict: string | null;
}
export interface NativeSyncState {
  replicaId: string;
  queuedOperations: number;
  queuedBytes: number;
  binding: SyncBinding | null;
}
export interface Baseline {
  manifest: CloudManifest;
  watermark: number;
  replicaId: string;
}
export interface SyncNative {
  state(): Promise<NativeSyncState>;
  pause(uid: string, enabled: boolean): Promise<void>;
  retry(uid: string): Promise<void>;
  prepareBaseline(
    uid: string,
    email: string,
    transferOwner: boolean,
  ): Promise<Baseline>;
  prepareReplacement(uid: string, email: string): Promise<Baseline>;
  baselineChunk(token: string, index: number): Promise<string>;
  releaseBaseline(token: string): Promise<void>;
  bindBaseline(
    uid: string,
    token: string,
    spaceId: string,
    baselineSequence?: number,
  ): Promise<void>;
  connect(
    uid: string,
    email: string,
    spaceId: string,
    token: string,
    baselineSequence?: number,
  ): Promise<void>;
  outgoing(uid: string): Promise<SyncOperation | null>;
  outgoingChunk(uid: string, id: string, index: number): Promise<string>;
  beginIncoming(uid: string, operation: SyncOperation): Promise<string>;
  acceptChunk(
    uid: string,
    token: string,
    index: number,
    data: string,
  ): Promise<void>;
  finishIncoming(uid: string, token: string): Promise<boolean>;
  releaseIncoming(uid: string, token: string): Promise<void>;
  acknowledge(uid: string, operation: SyncOperation): Promise<boolean>;
  resolveCloud(uid: string): Promise<void>;
}
export const syncNative: SyncNative = {
  state: () => invoke("sync_state"),
  pause: (uid, enabled) => invoke("sync_pause", { uid, enabled }),
  retry: (uid) => invoke("sync_retry", { uid }),
  prepareBaseline: (uid, email, transferOwner) =>
    invoke("sync_prepare_baseline", { uid, email, transferOwner }),
  prepareReplacement: (uid, email) =>
    invoke("sync_prepare_baseline", {
      uid,
      email,
      transferOwner: false,
      replacement: true,
    }),
  baselineChunk: (token, index) =>
    invoke("sync_baseline_chunk", { token, index }),
  releaseBaseline: (token) => invoke("sync_baseline_release", { token }),
  bindBaseline: (uid, token, spaceId, baselineSequence = 0) =>
    invoke("sync_bind_baseline", { uid, token, spaceId, baselineSequence }),
  connect: (uid, email, spaceId, token, baselineSequence = 0) =>
    invoke("sync_connect", { uid, email, spaceId, token, baselineSequence }),
  outgoing: (uid) => invoke("sync_outgoing", { uid }),
  outgoingChunk: (uid, operationId, index) =>
    invoke("sync_outgoing_chunk", { uid, operationId, index }),
  beginIncoming: (uid, operation) =>
    invoke("sync_begin_incoming", { uid, operation }),
  acceptChunk: (uid, token, index, data) =>
    invoke("sync_accept_chunk", { uid, token, index, data }),
  finishIncoming: (uid, token) =>
    invoke("sync_finish_incoming", { uid, token }),
  releaseIncoming: (uid, token) =>
    invoke("sync_release_incoming", { uid, token }),
  acknowledge: (uid, operation) =>
    invoke("sync_acknowledge", { uid, operation }),
  resolveCloud: (uid) => invoke("sync_resolve_cloud", { uid }),
};
export function baselineBridge(
  native: SyncNative,
  baseline: Baseline,
  downloads: SnapshotBridge,
): SnapshotBridge {
  return {
    ...downloads,
    prepare: async () => baseline.manifest,
    read: (token, index) => native.baselineChunk(token, index),
    release: (token) => native.releaseBaseline(token),
  };
}
export type { RestorePreview };
