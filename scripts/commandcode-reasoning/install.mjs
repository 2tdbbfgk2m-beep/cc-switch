import fs from "node:fs";
import path from "node:path";
import {
  hash,
  signApp,
  ensureStopped,
  transact,
  restoreSnapshot,
} from "../commandcode-desktop/transaction.mjs";
import { patchFullHarness, patchSdk, PATCH_VERSION } from "./patch.mjs";
export { hash, ensureStopped };
const manifests = JSON.parse(
  fs.readFileSync(new URL("./desktop-manifests.json", import.meta.url), "utf8"),
);
const owner = "cc-switch-reasoning";
export const TARGETS = {
  harness: {
    path: "Contents/Resources/app/node_modules/@commandcode/harness/dist/index.js",
    kind: "harness",
  },
  "openai-js": {
    path: "Contents/Resources/app/node_modules/@ai-sdk/openai/dist/index.js",
    kind: "openai",
  },
  "openai-mjs": {
    path: "Contents/Resources/app/node_modules/@ai-sdk/openai/dist/index.mjs",
    kind: "openai",
  },
  "anthropic-js": {
    path: "Contents/Resources/app/node_modules/@ai-sdk/anthropic/dist/index.js",
    kind: "anthropic",
  },
  "anthropic-mjs": {
    path: "Contents/Resources/app/node_modules/@ai-sdk/anthropic/dist/index.mjs",
    kind: "anthropic",
  },
};
const ensure = (ok, message) => {
  if (!ok) throw Error(message);
};
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const addon = (app) => path.join(app, "Contents/Resources", owner);
export function transactionFiles(plan) {
  return {
    ...Object.fromEntries(
      Object.entries(TARGETS).map(([id, t]) => [id + ".original", t.path]),
    ),
    "reasoning-addon": "Contents/Resources/" + owner,
  };
}
function readApp(app) {
  const version = json(
    path.join(app, "Contents/Resources/app/package.json"),
  ).version;
  const sources = Object.fromEntries(
    Object.entries(TARGETS).map(([id, t]) => {
      const file = path.join(app, t.path);
      ensure(
        fs.realpathSync(file).startsWith(fs.realpathSync(app) + path.sep),
        "目标文件不在应用内",
      );
      return [id, fs.readFileSync(file, "utf8")];
    }),
  );
  return { version, sources };
}
function previousText(installed) {
  if (installed.previousManifest !== undefined) {
    ensure(typeof installed.previousManifest === "string", "无效旧清单");
    return installed.previousManifest;
  }
  const ref = installed.previousManifestRef;
  if (!ref) return undefined;
  ensure(ref.file === "reasoning-addon/installed.json", "无效旧清单引用");
  const root = fs.realpathSync(installed.backupDir),
    file = path.join(root, ref.file);
  ensure(
    fs.realpathSync(file).startsWith(root + path.sep),
    "旧清单引用不在备份内",
  );
  const text = fs.readFileSync(file, "utf8");
  ensure(hash(text) === ref.sha256, "旧清单引用校验失败");
  return text;
}
function originalDir(installed) {
  const visited = new Set();
  let current = installed;
  while (current) {
    ensure(!visited.has(current.backupDir), "扩展备份链循环");
    visited.add(current.backupDir);
    if (current.originalBackupDir) return current.originalBackupDir;
    const previous = previousText(current);
    if (!previous) return current.backupDir;
    current = JSON.parse(previous);
  }
}
export function inspectApp(app) {
  const { version, sources } = readApp(app),
    file = path.join(addon(app), "installed.json");
  if (!fs.existsSync(file))
    return { status: "needs-extension", appVersion: version };
  const installed = json(file);
  ensure(
    installed.owner === owner &&
      [PATCH_VERSION, "1.0.0", "2.0.0", "2.0.1"].includes(
        installed.patchVersion,
      ) &&
      installed.appVersion === version,
    "已有扩展版本或归属不匹配，未修改",
  );
  for (const id of Object.keys(TARGETS))
    ensure(
      hash(sources[id]) === installed.patchedHashes[id],
      "已有扩展文件发生变化，未修改",
    );
  if (installed.runtimeHash)
    ensure(
      hash(fs.readFileSync(path.join(addon(app), "ultra.mjs"))) ===
        installed.runtimeHash,
      "Ultra 模块校验失败，未修改",
    );
  return {
    status:
      installed.patchVersion === PATCH_VERSION ? "patched" : "upgrade-required",
    appVersion: version,
    patchVersion: installed.patchVersion,
  };
}
export function prepareInstall(app, { trusted = manifests.versions } = {}) {
  const state = inspectApp(app);
  if (state.status === "patched")
    return { appDir: app, ...state, unchanged: true };
  const { version, sources } = readApp(app),
    previousManifest =
      state.status === "upgrade-required"
        ? fs.readFileSync(path.join(addon(app), "installed.json"), "utf8")
        : undefined;
  const originalBackupDir = previousManifest
    ? originalDir(JSON.parse(previousManifest))
    : undefined;
  const base = originalBackupDir
    ? Object.fromEntries(
        Object.keys(TARGETS).map((id) => [
          id,
          fs.readFileSync(
            path.join(originalBackupDir, id + ".original"),
            "utf8",
          ),
        ]),
      )
    : sources;
  const expected = trusted[version];
  ensure(expected, "未知 Command Code 版本，未修改应用");
  for (const id of Object.keys(TARGETS))
    ensure(
      hash(base[id]) === expected[id],
      `应用文件校验不匹配：${id}，未修改`,
    );
  const patched = Object.fromEntries(
    Object.entries(TARGETS).map(([id, t]) => [
      id,
      t.kind === "harness"
        ? patchFullHarness(base[id])
        : patchSdk(base[id], t.kind),
    ]),
  );
  return {
    appDir: app,
    appVersion: version,
    sources,
    previousManifest,
    originalBackupDir,
    patched,
    runtime: fs.readFileSync(new URL("./ultra.mjs", import.meta.url), "utf8"),
    originalHashes: Object.fromEntries(
      Object.entries(sources).map(([id, s]) => [id, hash(s)]),
    ),
  };
}
export function stageInstall(plan, { backupDir }) {
  const app = plan.appDir;
  ensure(readApp(app).version === plan.appVersion, "应用版本在预检后变化");
  ensure(
    plan.previousManifest
      ? fs.readFileSync(path.join(addon(app), "installed.json"), "utf8") ===
          plan.previousManifest
      : !fs.existsSync(addon(app)),
    "扩展目录在预检后变化",
  );
  for (const [id, t] of Object.entries(TARGETS))
    ensure(
      hash(fs.readFileSync(path.join(app, t.path))) === plan.originalHashes[id],
      "应用在预检后变化",
    );
  fs.mkdirSync(addon(app), { recursive: true });
  fs.writeFileSync(path.join(addon(app), "ultra.mjs"), plan.runtime);
  fs.writeFileSync(
    path.join(addon(app), "installed.json"),
    JSON.stringify(
      {
        owner,
        patchVersion: PATCH_VERSION,
        appVersion: plan.appVersion,
        backupDir,
        originalBackupDir: plan.originalBackupDir ?? backupDir,
        ...(plan.previousManifest
          ? {
              previousManifestRef: {
                file: "reasoning-addon/installed.json",
                sha256: hash(plan.previousManifest),
              },
            }
          : {}),
        runtimeHash: hash(plan.runtime),
        patchedHashes: Object.fromEntries(
          Object.entries(plan.patched).map(([id, s]) => [id, hash(s)]),
        ),
      },
      null,
      2,
    ),
  );
  for (const [id, t] of Object.entries(TARGETS))
    fs.writeFileSync(path.join(app, t.path), plan.patched[id]);
  return {
    status: "patched",
    appVersion: plan.appVersion,
    patchVersion: PATCH_VERSION,
    backupDir,
  };
}
export function applyInstall(plan, { backupRoot, sign = signApp } = {}) {
  if (plan.unchanged) return { unchanged: true, status: plan.status };
  return transact({
    app: plan.appDir,
    files: transactionFiles(plan),
    label: "reasoning-" + plan.appVersion,
    backupRoot,
    sign,
    mutate: (ctx) => stageInstall(plan, ctx),
  }).result;
}
export function removeInstall(
  app,
  { backupRoot, sign = signApp, verify = () => {} } = {},
) {
  ensure(
    ["patched", "upgrade-required"].includes(inspectApp(app).status),
    "未找到受管理的扩展",
  );
  const installed = json(path.join(addon(app), "installed.json")),
    files = transactionFiles({ appDir: app });
  // Validate all originals before the shared transaction changes any app file.
  let originals;
  if (!fs.existsSync(path.join(installed.backupDir, "transaction.json"))) {
    const legacy = json(path.join(installed.backupDir, "backup.json"));
    originals = Object.fromEntries(
      Object.entries(TARGETS).map(([id]) => {
        const name = id + ".original",
          value = fs.readFileSync(path.join(installed.backupDir, name));
        ensure(
          legacy.files[name] === TARGETS[id].path &&
            hash(value) === legacy.hashes[name],
          "备份校验失败",
        );
        return [id, value];
      }),
    );
  }
  const prior = previousText(installed);
  return transact({
    app,
    files,
    label: "reasoning-remove",
    backupRoot,
    sign: (app) => {
      sign(app);
      verify(app);
    },
    mutate: () => {
      if (originals) {
        for (const [id, t] of Object.entries(TARGETS))
          fs.writeFileSync(path.join(app, t.path), originals[id]);
        if (prior)
          fs.writeFileSync(path.join(addon(app), "installed.json"), prior);
        else fs.rmSync(addon(app), { recursive: true });
      } else restoreSnapshot(app, installed.backupDir, { files });
      return { removed: true, backupDir: installed.backupDir };
    },
  }).result;
}
export async function checkUpstream(fetchImpl = fetch) {
  const response = await fetchImpl(
    "https://api.github.com/repos/CommandCodeAI/desktop/releases/latest",
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15000),
    },
  );
  ensure(response.ok, `读取官方版本失败：HTTP ${response.status}`);
  const data = await response.json(),
    version = String(data.tag_name ?? "").replace(/^v/, "");
  return {
    version,
    url: data.html_url,
    nativeEfforts:
      version === manifests.upstreamAudit.version
        ? manifests.upstreamAudit.nativeEfforts
        : null,
    codeAudited: version === manifests.upstreamAudit.version,
    ultraOrchestration:
      version === manifests.upstreamAudit.version
        ? manifests.upstreamAudit.ultraOrchestration
        : null,
  };
}
