import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/firebase-cloud.test.ts", "tests/sync-cloud.test.ts"], { stdio: "inherit", env: { ...process.env, CHEFISH_NATIVE_SYNC_TEST: "1" } });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
