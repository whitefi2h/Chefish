import { initialState } from "../fixtures/demo";
import type { DemoState } from "../model";
// Browser-only fixture adapter. Snapshot mutation is never used for native writes.
export const demoClient = {
  load: initialState,
  update: (state: DemoState, fn: (s: DemoState) => DemoState) => fn(state),
};
