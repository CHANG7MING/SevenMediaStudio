import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("the app theme follows the system instead of a saved dark preference", async () => {
  const provider = await readFile(new URL("../components/GlobalThemeProvider.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(provider, /localStorage\.(?:getItem|setItem)\([^)]*theme/);
  assert.match(provider, /addEventListener\("change"/);
  assert.match(provider, /removeEventListener\("change"/);
  assert.match(styles, /^:root\s*\{\s*color-scheme:\s*light dark;/);
});
