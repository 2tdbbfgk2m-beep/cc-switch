import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { signApp, ensureStopped } from "../commandcode-documents/install.mjs";
import { patchFullHarness, patchSdk, PATCH_VERSION } from "./patch.mjs";
export { ensureStopped };
export const hash = (data) =>
  crypto.createHash("sha256").update(data).digest("hex");
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
const signatures = [
  "Contents/MacOS/Command Code",
  "Contents/_CodeSignature/CodeResources",
];
const ensure = (condition, message) => {
  if (!condition) throw Error(message);
};
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const addon = (app) => path.join(app, "Contents/Resources", owner);
function readApp(app) {
  const version = json(
    path.join(app, "Contents/Resources/app/package.json"),
  ).version;
  const sources = Object.fromEntries(
    Object.entries(TARGETS).map(([id, target]) => {
      const file = path.join(app, target.path);
      ensure(
        fs.realpathSync(file).startsWith(fs.realpathSync(app) + path.sep),
        "目标文件不在应用内，未修改。",
      );
      return [id, fs.readFileSync(file, "utf8")];
    }),
  );
  return { version, sources };
}
export function inspectApp(app) {
  const { version, sources } = readApp(app);
  const installedFile = path.join(addon(app), "installed.json");
  if (fs.existsSync(installedFile)) {
    const installed = json(installedFile);
    ensure(
      installed.owner === owner &&
        [PATCH_VERSION, "1.0.0", "2.0.0"].includes(installed.patchVersion) &&
        installed.appVersion === version,
      "已有扩展版本或归属不匹配，未修改。",
    );
    for (const id of Object.keys(TARGETS))
      ensure(
        hash(sources[id]) === installed.patchedHashes[id],
        "已有扩展文件发生变化，未修改。",
      );
    return {
      status:
        installed.patchVersion === PATCH_VERSION
          ? "patched"
          : "upgrade-required",
      appVersion: version,
      patchVersion: installed.patchVersion,
    };
  }
  // Native effort strings alone do not prove orchestration or budget enforcement.
  return { status: "needs-extension", appVersion: version };
}
export function prepareInstall(app, { trusted = manifests.versions } = {}) {
  const state = inspectApp(app);
  if (state.status === "native" || state.status === "patched")
    return {
      appDir: app,
      appVersion: state.appVersion,
      unchanged: true,
      status: state.status,
    };
  const { version, sources } = readApp(app);
  const previousManifest =
    state.status === "upgrade-required"
      ? fs.readFileSync(path.join(addon(app), "installed.json"), "utf8")
      : undefined;
  let originalManifest = previousManifest
    ? JSON.parse(previousManifest)
    : undefined;
  const visited = new Set();
  while (originalManifest?.previousManifest) {
    ensure(
      !visited.has(originalManifest.backupDir),
      "扩展备份链循环，未修改。",
    );
    visited.add(originalManifest.backupDir);
    originalManifest = JSON.parse(originalManifest.previousManifest);
  }
  const baseSources = originalManifest
    ? Object.fromEntries(
        Object.keys(TARGETS).map((id) => [
          id,
          fs.readFileSync(
            path.join(originalManifest.backupDir, `${id}.original`),
            "utf8",
          ),
        ]),
      )
    : sources;
  const expected = trusted[version];
  ensure(expected, "未知 Command Code 版本；请先核对官方更新，未修改应用。");
  for (const id of Object.keys(TARGETS))
    ensure(
      hash(baseSources[id]) === expected[id],
      `应用文件校验不匹配：${id}，未修改。`,
    );
  const patched = Object.fromEntries(
    Object.entries(TARGETS).map(([id, target]) => [
      id,
      target.kind === "harness"
        ? patchFullHarness(baseSources[id])
        : patchSdk(baseSources[id], target.kind),
    ]),
  );
  return {
    appDir: app,
    appVersion: version,
    sources,
    previousManifest,
    patched,
    originalHashes: Object.fromEntries(
      Object.keys(sources).map((id) => [id, hash(sources[id])]),
    ),
  };
}
function backup(app, dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const files = {
    ...Object.fromEntries(
      Object.entries(TARGETS).map(([id, target]) => [
        `${id}.original`,
        target.path,
      ]),
    ),
    ...Object.fromEntries(signatures.map((name) => [name, name])),
  };
  for (const [name, relative] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(app, relative), target);
  }
  const hashes = Object.fromEntries(
    Object.keys(files).map((name) => [
      name,
      hash(fs.readFileSync(path.join(dir, name))),
    ]),
  );
  fs.writeFileSync(
    path.join(dir, "backup.json"),
    JSON.stringify({ files, hashes }),
  );
}
function restore(app, dir) {
  const { files, hashes } = json(path.join(dir, "backup.json"));
  const allowed = new Set([
    ...Object.values(TARGETS).map((t) => t.path),
    ...signatures,
  ]);
  for (const [name, relative] of Object.entries(files)) {
    ensure(
      allowed.has(relative) &&
        !path.isAbsolute(name) &&
        !name.split(/[\\/]/).includes(".."),
      "备份路径校验失败。",
    );
    ensure(
      hash(fs.readFileSync(path.join(dir, name))) === hashes[name],
      "备份内容校验失败。",
    );
  }
  for (const [name, relative] of Object.entries(files))
    fs.copyFileSync(path.join(dir, name), path.join(app, relative));
}
export function applyInstall(
  plan,
  {
    backupRoot = path.join(os.homedir(), ".commandcode/desktop-backups"),
    sign = signApp,
  } = {},
) {
  if (plan.unchanged) return { unchanged: true, status: plan.status };
  const app = plan.appDir;
  ensure(
    readApp(app).version === plan.appVersion,
    "应用版本在预检后变化，未修改。",
  );
  ensure(
    plan.previousManifest
      ? fs.readFileSync(path.join(addon(app), "installed.json"), "utf8") ===
          plan.previousManifest
      : !fs.existsSync(addon(app)),
    "扩展目录在预检后变化，未修改。",
  );
  for (const [id, target] of Object.entries(TARGETS))
    ensure(
      hash(fs.readFileSync(path.join(app, target.path))) ===
        plan.originalHashes[id],
      "应用在预检后变化，未修改。",
    );
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const backupDir = fs.mkdtempSync(
    path.join(backupRoot, `reasoning-${plan.appVersion}-`),
  );
  backup(app, backupDir);
  let owned = false;
  try {
    if (!plan.previousManifest) {
      fs.mkdirSync(addon(app));
      owned = true;
    }
    fs.writeFileSync(
      path.join(addon(app), "installed.json"),
      JSON.stringify(
        {
          owner,
          ...(plan.previousManifest
            ? { previousManifest: plan.previousManifest }
            : {}),
          patchVersion: PATCH_VERSION,
          appVersion: plan.appVersion,
          backupDir,
          patchedHashes: Object.fromEntries(
            Object.entries(plan.patched).map(([id, source]) => [
              id,
              hash(source),
            ]),
          ),
        },
        null,
        2,
      ),
    );
    for (const [id, target] of Object.entries(TARGETS))
      fs.writeFileSync(path.join(app, target.path), plan.patched[id]);
    sign(app);
    fs.writeFileSync(
      path.join(backupDir, "installed-signatures.json"),
      JSON.stringify(
        Object.fromEntries(
          signatures.map((name) => [
            name,
            hash(fs.readFileSync(path.join(app, name))),
          ]),
        ),
      ),
    );
    return { status: "patched", appVersion: plan.appVersion, backupDir };
  } catch (error) {
    restore(app, backupDir);
    if (owned) fs.rmSync(addon(app), { recursive: true });
    else if (plan.previousManifest)
      fs.writeFileSync(
        path.join(addon(app), "installed.json"),
        plan.previousManifest,
      );
    throw error;
  }
}
export function removeInstall(
  app,
  {
    verify = (app) =>
      execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
        stdio: "pipe",
      }),
  } = {},
) {
  ensure(
    ["patched", "upgrade-required"].includes(inspectApp(app).status),
    "未找到受管理的扩展，未修改。",
  );
  const installed = json(path.join(addon(app), "installed.json"));
  const expected = json(
    path.join(installed.backupDir, "installed-signatures.json"),
  );
  for (const name of signatures)
    ensure(
      hash(fs.readFileSync(path.join(app, name))) === expected[name],
      "安装后应用签名已变化，保留现状；请先核对其他补丁。",
    );
  const current = new Map(
    [...Object.values(TARGETS).map((t) => t.path), ...signatures].map(
      (relative) => [relative, fs.readFileSync(path.join(app, relative))],
    ),
  );
  const stash = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-reasoning-remove-"));
  let moved = false;
  try {
    restore(app, installed.backupDir);
    if (installed.previousManifest)
      fs.writeFileSync(
        path.join(addon(app), "installed.json"),
        installed.previousManifest,
      );
    else {
      fs.renameSync(addon(app), path.join(stash, "addon"));
      moved = true;
    }
    verify(app);
  } catch (error) {
    for (const [relative, bytes] of current)
      if (!fs.readFileSync(path.join(app, relative)).equals(bytes))
        fs.writeFileSync(path.join(app, relative), bytes);
    if (moved) fs.renameSync(path.join(stash, "addon"), addon(app));
    else if (installed.previousManifest)
      fs.writeFileSync(
        path.join(addon(app), "installed.json"),
        JSON.stringify(installed, null, 2),
      );
    throw error;
  } finally {
    fs.rmSync(stash, { recursive: true, force: true });
  }

  return { removed: true, backupDir: installed.backupDir };
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
  const data = await response.json();
  const version = String(data.tag_name ?? "").replace(/^v/, "");
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
