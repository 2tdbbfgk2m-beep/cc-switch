import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  transact,
  restoreSnapshot,
} from "../../scripts/commandcode-desktop/transaction.mjs";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-transaction-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "App.app");
  const write = (p, s) => {
    const f = path.join(app, p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, s);
  };
  write("Contents/MacOS/Command Code", "exe");
  write("Contents/_CodeSignature/CodeResources", "seal");
  write("Contents/renderer.js", "original");
  write("Contents/other.js", "other feature");
  return {
    root,
    app,
    write,
    files: { "renderer.js": "Contents/renderer.js", addon: "Contents/addon" },
    backupRoot: path.join(root, "backups"),
  };
}
test("shared transaction restores current signatures and owned files on signing failure", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      transact({
        ...f,
        label: "test",
        mutate: () => {
          f.write("Contents/renderer.js", "changed");
          f.write("Contents/addon/new.mjs", "new");
        },
        sign: () => {
          f.write("Contents/MacOS/Command Code", "partial signature");
          throw Error("sign failed");
        },
      }),
    /sign failed/,
  );
  assert.equal(
    fs.readFileSync(path.join(f.app, "Contents/renderer.js"), "utf8"),
    "original",
  );
  assert.equal(
    fs.readFileSync(path.join(f.app, "Contents/MacOS/Command Code"), "utf8"),
    "exe",
  );
  assert.equal(fs.existsSync(path.join(f.app, "Contents/addon")), false);
});
test("selective restoration leaves other component changes and current signatures intact", (t) => {
  const f = fixture(t);
  const { backupDir } = transact({
    ...f,
    label: "test",
    mutate: () => {
      f.write("Contents/renderer.js", "patched");
      f.write("Contents/addon/new.mjs", "new");
    },
    sign: () => {},
  });
  f.write("Contents/other.js", "later feature");
  f.write("Contents/MacOS/Command Code", "current signed executable");
  restoreSnapshot(f.app, backupDir, { files: f.files });
  assert.equal(
    fs.readFileSync(path.join(f.app, "Contents/renderer.js"), "utf8"),
    "original",
  );
  assert.equal(
    fs.readFileSync(path.join(f.app, "Contents/other.js"), "utf8"),
    "later feature",
  );
  assert.equal(
    fs.readFileSync(path.join(f.app, "Contents/MacOS/Command Code"), "utf8"),
    "current signed executable",
  );
});
test("corrupted snapshots refuse restoration before changing any app file", (t) => {
  const f = fixture(t);
  const { backupDir } = transact({
    ...f,
    label: "test",
    mutate: () => f.write("Contents/renderer.js", "patched"),
    sign: () => {},
  });
  fs.writeFileSync(path.join(backupDir, "renderer.js"), "corrupt");
  assert.throws(
    () =>
      restoreSnapshot(f.app, backupDir, {
        files: { "renderer.js": f.files["renderer.js"] },
      }),
    /校验/,
  );
  assert.equal(
    fs.readFileSync(path.join(f.app, "Contents/renderer.js"), "utf8"),
    "patched",
  );
});
test("backup metadata cannot redirect owned restoration to another app path", (t) => {
  const f = fixture(t);
  const { backupDir } = transact({
    ...f,
    label: "test",
    mutate: () => f.write("Contents/renderer.js", "patched"),
    sign: () => {},
  });
  const file = path.join(backupDir, "transaction.json"),
    manifest = JSON.parse(fs.readFileSync(file));
  manifest.files["renderer.js"].relative = "Contents";
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(
    () => restoreSnapshot(f.app, backupDir, { files: f.files }),
    /归属/,
  );
  assert.equal(
    fs.readFileSync(path.join(f.app, "Contents/renderer.js"), "utf8"),
    "patched",
  );
});
test("a broken symlink at a component path is refused and retained", (t) => {
  const f = fixture(t);
  const link = path.join(f.app, "Contents/addon");
  fs.symlinkSync("/synthetic/nonexistent-target", link);
  assert.throws(
    () => transact({ ...f, label: "test", mutate: () => {}, sign: () => {} }),
    /符号/,
  );
  assert.ok(fs.lstatSync(link).isSymbolicLink());
});
