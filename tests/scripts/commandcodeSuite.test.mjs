import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateRelease } from "../../scripts/commandcode-desktop/suite.mjs";
import { hash } from "../../scripts/commandcode-desktop/transaction.mjs";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-package-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "script.mjs"), "synthetic");
  fs.writeFileSync(
    path.join(root, "suite.json"),
    JSON.stringify({
      owner: "cc-switch-extensions",
      version: "1.0.0",
      files: { "script.mjs": hash("synthetic") },
    }),
  );
  return root;
}
test("standalone package rejects missing changed extra files and symlinks", (t) => {
  const root = fixture(t);
  assert.equal(validateRelease(root).version, "1.0.0");
  fs.writeFileSync(path.join(root, "script.mjs"), "tampered");
  assert.throws(() => validateRelease(root), /校验/);
  fs.writeFileSync(path.join(root, "script.mjs"), "synthetic");
  fs.writeFileSync(path.join(root, "extra"), "extra");
  assert.throws(() => validateRelease(root), /清单/);
  fs.rmSync(path.join(root, "extra"));
  fs.symlinkSync("script.mjs", path.join(root, "link"));
  assert.throws(() => validateRelease(root), /符号/);
});
