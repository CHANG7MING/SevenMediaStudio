import test from "node:test";
import assert from "node:assert/strict";
import { getDesktopAppInfo, isDesktopRuntime } from "./bridge.ts";

test("does not report desktop runtime in a regular Node or browser-less environment", () => {
  assert.equal(isDesktopRuntime(), false);
});

test("rejects desktop IPC when the Tauri runtime is unavailable", async () => {
  await assert.rejects(
    getDesktopAppInfo(),
    /desktop runtime is not available/i,
  );
});
