import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hash,
  validateBundle,
  prepareInstall,
  applyInstall,
} from "../../scripts/commandcode-documents/install.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-doc-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appDir = path.join(root, "app"),
    bundleDir = path.join(root, "bundle"),
    renderer = path.join(appDir, "renderer.js"),
    addon = path.join(appDir, "cc-switch-documents");
  for (const file of [
    renderer,
    path.join(appDir, "Contents/MacOS/Command Code"),
    path.join(appDir, "Contents/_CodeSignature/CodeResources"),
    path.join(appDir, "Contents/Resources/app/package.json"),
  ]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      file.endsWith("package.json") ? '{"version":"0.1.61"}' : "original",
    );
  }
  fs.mkdirSync(bundleDir);
  fs.writeFileSync(
    path.join(bundleDir, "parser.mjs"),
    "export const parser=true;",
  );
  fs.writeFileSync(
    path.join(bundleDir, "bundle.json"),
    JSON.stringify({
      owner: "cc-switch-documents",
      version: "1.0.0",
      files: {
        "parser.mjs": hash(fs.readFileSync(path.join(bundleDir, "parser.mjs"))),
      },
    }),
  );
  const config = path.join(root, "config.json");
  fs.writeFileSync(config, '{"keep":"session/config"}');
  return {
    root,
    appDir,
    bundleDir,
    renderer,
    addon,
    originalHash: hash("original"),
    patched: "patched",
    config,
  };
}
test("transaction installs only renderer/assets and retains verified backups", (t) => {
  const f = fixture(t),
    before = fs.readFileSync(f.config);
  const result = applyInstall(f, {
    backupRoot: path.join(f.root, "backups"),
    sign: () => {},
  });
  assert.equal(fs.readFileSync(f.renderer, "utf8"), "patched");
  assert.equal(
    fs.readFileSync(path.join(result.backupDir, "renderer.js"), "utf8"),
    "original",
  );
  assert.deepEqual(fs.readFileSync(f.config), before);
  assert.equal(validateBundle(f.addon, true).version, "1.0.0");
  assert.deepEqual(applyInstall({ unchanged: true }), { unchanged: true });
});
test("signing failure restores renderer, executable and resource seal", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      applyInstall(f, {
        backupRoot: path.join(f.root, "backups"),
        sign: () => {
          fs.writeFileSync(
            path.join(f.appDir, "Contents/MacOS/Command Code"),
            "changed",
          );
          throw Error("sign failed");
        },
      }),
    /sign failed/,
  );
  assert.equal(fs.readFileSync(f.renderer, "utf8"), "original");
  assert.equal(
    fs.readFileSync(path.join(f.appDir, "Contents/MacOS/Command Code"), "utf8"),
    "original",
  );
  assert.equal(fs.existsSync(f.addon), false);
});
test("tampered and extra bundle files fail before app mutation", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.bundleDir, "parser.mjs"), "tampered");
  assert.throws(() => applyInstall(f, { sign: () => {} }), /校验失败/);
  assert.equal(fs.readFileSync(f.renderer, "utf8"), "original");
  fs.writeFileSync(path.join(f.bundleDir, "extra.mjs"), "x");
  assert.throws(() => validateBundle(f.bundleDir), /清单/);
});
test("unsupported app version or hash is rejected", (t) => {
  const f = fixture(t);
  fs.mkdirSync(
    path.join(f.appDir, "Contents/Resources/app/out/renderer/assets"),
    { recursive: true },
  );
  assert.throws(() => prepareInstall(f.appDir, f.bundleDir), /ENOENT/);
  fs.writeFileSync(
    path.join(f.appDir, "Contents/Resources/app/package.json"),
    '{"version":"0.2.0"}',
  );
  assert.throws(() => prepareInstall(f.appDir, f.bundleDir), /仅支持/);
});
