import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { desktop, PATCH_VERSION, patchRenderer } from "./patch.mjs";

export const hash = (data) =>
  crypto.createHash("sha256").update(data).digest("hex");
const owner = "cc-switch-documents";
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
function filesBelow(dir, relative = "") {
  return fs
    .readdirSync(path.join(dir, relative), { withFileTypes: true })
    .flatMap((entry) => {
      ensure(!entry.isSymbolicLink(), "解析包不能包含符号链接。");
      const name = path.posix.join(relative, entry.name);
      return entry.isDirectory() ? filesBelow(dir, name) : [name];
    });
}
export function validateBundle(dir, installed = false) {
  const manifest = readJson(path.join(dir, "bundle.json"));
  ensure(
    manifest.owner === owner && manifest.version === PATCH_VERSION,
    "解析包版本不匹配。",
  );
  const expected = Object.keys(manifest.files).sort();
  const actual = filesBelow(dir)
    .filter(
      (name) =>
        name !== "bundle.json" && !(installed && name === "installed.json"),
    )
    .sort();
  ensure(
    JSON.stringify(expected) === JSON.stringify(actual),
    "解析包文件清单不完整。",
  );
  for (const name of expected) {
    ensure(
      !path.isAbsolute(name) && !name.split(/[\\/]/).includes(".."),
      "解析包路径无效。",
    );
    ensure(
      hash(fs.readFileSync(path.join(dir, name))) === manifest.files[name],
      `解析包校验失败：${name}`,
    );
  }
  ensure(expected.includes("parser.mjs"), "解析包缺少入口。");
  return manifest;
}
export function prepareInstall(appDir, bundleDir) {
  ensure(
    readJson(path.join(appDir, "Contents/Resources/app/package.json"))
      .version === desktop.version,
    "仅支持 Command Code 0.1.61，未修改应用。",
  );
  const renderer = path.join(
    appDir,
    "Contents/Resources/app/out/renderer/assets",
    desktop.renderer,
  );
  const addon = path.join(path.dirname(renderer), owner);
  const source = fs.readFileSync(renderer, "utf8");
  validateBundle(bundleDir);
  if (fs.existsSync(addon)) {
    const installed = readJson(path.join(addon, "installed.json"));
    ensure(
      installed.owner === owner &&
        installed.version === PATCH_VERSION &&
        installed.patchedHash === hash(source),
      "已有补丁状态异常，未修改应用。",
    );
    validateBundle(addon, true);
    ensure(
      hash(fs.readFileSync(path.join(addon, "bundle.json"))) ===
        hash(fs.readFileSync(path.join(bundleDir, "bundle.json"))),
      "已有不同的文档补丁，请先移除旧补丁。",
    );
    return { appDir, renderer, addon, unchanged: true };
  }
  ensure(hash(source) === desktop.sha256, "附件代码哈希不匹配，未修改应用。");
  return {
    appDir,
    bundleDir,
    renderer,
    addon,
    originalHash: hash(source),
    patched: patchRenderer(source),
  };
}
export function signApp(appDir) {
  execFileSync(
    "codesign",
    [
      "--force",
      "--sign",
      "-",
      "--preserve-metadata=identifier,entitlements,flags,runtime",
      appDir,
    ],
    { stdio: "pipe" },
  );
  execFileSync("codesign", ["--verify", "--deep", "--strict", appDir], {
    stdio: "pipe",
  });
}
function signatureFiles(appDir) {
  return [
    "Contents/MacOS/Command Code",
    "Contents/_CodeSignature/CodeResources",
  ].map((name) => ({ name, file: path.join(appDir, name) }));
}
function backupFiles(plan, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const files = [
    { name: "renderer.js", file: plan.renderer },
    ...signatureFiles(plan.appDir),
  ];
  for (const { name, file } of files) {
    ensure(fs.existsSync(file), `缺少待备份文件：${name}`);
    const target = path.join(backupDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
  }
  fs.writeFileSync(
    path.join(backupDir, "hashes.json"),
    JSON.stringify(
      Object.fromEntries(
        files.map(({ name, file }) => [name, hash(fs.readFileSync(file))]),
      ),
      null,
      2,
    ),
  );
}
function restoreFiles(plan, backupDir) {
  const checksums = readJson(path.join(backupDir, "hashes.json"));
  for (const [name, checksum] of Object.entries(checksums))
    ensure(
      hash(fs.readFileSync(path.join(backupDir, name))) === checksum,
      "备份校验失败，已保留当前应用。",
    );
  for (const name of Object.keys(checksums))
    fs.copyFileSync(
      path.join(backupDir, name),
      name === "renderer.js" ? plan.renderer : path.join(plan.appDir, name),
    );
}
// Exported transaction accepts an already prepared plan; CLI always uses prepareInstall.
export function applyInstall(
  plan,
  {
    backupRoot = path.join(os.homedir(), ".commandcode/desktop-backups"),
    sign = signApp,
  } = {},
) {
  if (plan.unchanged) return { unchanged: true };
  ensure(
    hash(fs.readFileSync(plan.renderer)) === plan.originalHash &&
      !fs.existsSync(plan.addon),
    "应用在校验后发生变化，未修改应用。",
  );
  validateBundle(plan.bundleDir);
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const backupDir = fs.mkdtempSync(path.join(backupRoot, "documents-0.1.61-"));
  backupFiles(plan, backupDir);
  const staged = plan.addon + `.staging-${crypto.randomUUID()}`;
  let owned = false;
  try {
    fs.cpSync(plan.bundleDir, staged, { recursive: true });
    validateBundle(staged);
    const manifest = {
      owner,
      version: PATCH_VERSION,
      originalHash: plan.originalHash,
      patchedHash: hash(plan.patched),
      backupDir,
    };
    fs.writeFileSync(
      path.join(staged, "installed.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    fs.renameSync(staged, plan.addon);
    owned = true;
    fs.writeFileSync(plan.renderer, plan.patched);
    sign(plan.appDir);
    fs.writeFileSync(
      path.join(backupDir, "installed-signature-hashes.json"),
      JSON.stringify(
        Object.fromEntries(
          signatureFiles(plan.appDir).map(({ name, file }) => [
            name,
            hash(fs.readFileSync(file)),
          ]),
        ),
      ),
    );
    return { version: PATCH_VERSION, backupDir, renderer: plan.renderer };
  } catch (error) {
    restoreFiles(plan, backupDir);
    if (owned) fs.rmSync(plan.addon, { recursive: true });
    throw error;
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}
export function removeInstall(appDir) {
  ensure(
    readJson(path.join(appDir, "Contents/Resources/app/package.json"))
      .version === desktop.version,
    "应用版本已变化，未修改应用。",
  );
  const renderer = path.join(
    appDir,
    "Contents/Resources/app/out/renderer/assets",
    desktop.renderer,
  );
  const addon = path.join(path.dirname(renderer), owner);
  const installed = readJson(path.join(addon, "installed.json"));
  ensure(
    installed.owner === owner &&
      installed.originalHash === desktop.sha256 &&
      hash(fs.readFileSync(renderer)) === installed.patchedHash,
    "补丁状态不匹配，未修改应用。",
  );
  validateBundle(addon, true);
  ensure(
    hash(fs.readFileSync(path.join(installed.backupDir, "renderer.js"))) ===
      desktop.sha256,
    "原始备份不匹配，未修改应用。",
  );
  const signedHashes = readJson(
    path.join(installed.backupDir, "installed-signature-hashes.json"),
  );
  for (const { name, file } of signatureFiles(appDir))
    ensure(
      hash(fs.readFileSync(file)) === signedHashes[name],
      "应用签名文件已变化，未修改应用。",
    );
  restoreFiles({ appDir, renderer }, installed.backupDir);
  fs.rmSync(addon, { recursive: true });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appDir], {
    stdio: "pipe",
  });
  return { removed: true, backupDir: installed.backupDir };
}
export function ensureStopped(appDir) {
  const expression = path
    .join(appDir, "Contents/MacOS/Command Code")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    execFileSync("pgrep", ["-f", expression], { stdio: "pipe" });
  } catch (error) {
    if (error.status === 1) return;
    throw error;
  }
  throw new Error("请先退出 Command Code；配置和会话不会被修改。");
}
