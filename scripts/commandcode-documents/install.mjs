import fs from "node:fs";
import path from "node:path";
import { desktop, PATCH_VERSION, patchRenderer } from "./patch.mjs";

import {
  hash,
  signApp,
  transact,
} from "../commandcode-desktop/transaction.mjs";
export { hash };
const owner = "cc-switch-documents";
const isSupportedRenderer = (digest) =>
  [desktop.sha256, desktop.officialSha256].includes(digest);
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
  ensure(isSupportedRenderer(hash(source)), "附件代码哈希不匹配，未修改应用。");
  return {
    appDir,
    bundleDir,
    renderer,
    addon,
    originalHash: hash(source),
    patched: patchRenderer(source),
  };
}

export { signApp, ensureStopped } from "../commandcode-desktop/transaction.mjs";
export function transactionFiles(plan) {
  return {
    "renderer.js": path.relative(plan.appDir, plan.renderer),
    "documents-addon": path.relative(plan.appDir, plan.addon),
  };
}
export function stageInstall(plan, { backupDir }) {
  ensure(
    hash(fs.readFileSync(plan.renderer)) === plan.originalHash &&
      !fs.existsSync(plan.addon),
    "应用在校验后变化，未修改应用。",
  );
  validateBundle(plan.bundleDir);
  fs.cpSync(plan.bundleDir, plan.addon, { recursive: true });
  fs.writeFileSync(
    path.join(plan.addon, "installed.json"),
    JSON.stringify(
      {
        owner,
        version: PATCH_VERSION,
        originalHash: plan.originalHash,
        patchedHash: hash(plan.patched),
        backupDir,
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(plan.renderer, plan.patched);
  return { version: PATCH_VERSION, backupDir, renderer: plan.renderer };
}
export function applyInstall(plan, { backupRoot, sign = signApp } = {}) {
  if (plan.unchanged) return { unchanged: true };
  return transact({
    app: plan.appDir,
    files: transactionFiles(plan),
    label: "documents-0.1.61",
    backupRoot,
    sign,
    mutate: (ctx) => stageInstall(plan, ctx),
  }).result;
}
export function removeInstall(
  appDir,
  { backupRoot, sign = signApp, verify = () => {} } = {},
) {
  ensure(
    readJson(path.join(appDir, "Contents/Resources/app/package.json"))
      .version === desktop.version,
    "应用版本已变化，未修改应用。",
  );
  const renderer = path.join(
      appDir,
      "Contents/Resources/app/out/renderer/assets",
      desktop.renderer,
    ),
    addon = path.join(path.dirname(renderer), owner);
  const installed = readJson(path.join(addon, "installed.json"));
  ensure(
    installed.owner === owner &&
      isSupportedRenderer(installed.originalHash) &&
      hash(fs.readFileSync(renderer)) === installed.patchedHash,
    "补丁状态不匹配，未修改应用。",
  );
  validateBundle(addon, true);
  const original = fs.readFileSync(
    path.join(installed.backupDir, "renderer.js"),
  );
  ensure(
    hash(original) === installed.originalHash,
    "原始备份不匹配，未修改应用。",
  );
  return transact({
    app: appDir,
    files: transactionFiles({ appDir, renderer, addon }),
    label: "documents-remove",
    backupRoot,
    sign: (app) => {
      sign(app);
      verify(app);
    },
    mutate: () => {
      fs.writeFileSync(renderer, original);
      fs.rmSync(addon, { recursive: true });
      return { removed: true, backupDir: installed.backupDir };
    },
  }).result;
}

export function inspectApp(appDir) {
  const version = readJson(
    path.join(appDir, "Contents/Resources/app/package.json"),
  ).version;
  if (version !== desktop.version)
    return { status: "unsupported", appVersion: version };
  const renderer = path.join(
      appDir,
      "Contents/Resources/app/out/renderer/assets",
      desktop.renderer,
    ),
    addon = path.join(path.dirname(renderer), owner);
  if (!fs.existsSync(addon))
    return { status: "needs-extension", appVersion: version };
  const installed = readJson(path.join(addon, "installed.json"));
  ensure(
    installed.owner === owner &&
      installed.patchedHash === hash(fs.readFileSync(renderer)),
    "已有文档补丁校验失败",
  );
  validateBundle(addon, true);
  return {
    status: "patched",
    appVersion: version,
    patchVersion: installed.version,
  };
}
