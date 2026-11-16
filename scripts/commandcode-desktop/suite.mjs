import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as documents from "../commandcode-documents/install.mjs";
import * as reasoning from "../commandcode-reasoning/install.mjs";
import { hash, transact, signApp } from "./transaction.mjs";
export const SUITE_VERSION = "1.0.0";
export function validateRelease(root) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "suite.json"), "utf8"),
  );
  if (
    manifest.owner !== "cc-switch-extensions" ||
    manifest.version !== SUITE_VERSION
  )
    throw Error("扩展包版本或归属错误");
  const names = fs.readdirSync(root, { recursive: true });
  for (const name of names)
    if (fs.lstatSync(path.join(root, name)).isSymbolicLink())
      throw Error("扩展包不能包含符号链接");
  const actual = names
    .filter(
      (name) =>
        fs.statSync(path.join(root, name)).isFile() && name !== "suite.json",
    )
    .sort();
  if (
    JSON.stringify(actual) !==
    JSON.stringify(Object.keys(manifest.files).sort())
  )
    throw Error("扩展包文件清单不完整");
  for (const name of actual)
    if (hash(fs.readFileSync(path.join(root, name))) !== manifest.files[name])
      throw Error("扩展包文件校验失败：" + name);
  return manifest;
}
export function inspectSuite(app, { home = os.homedir() } = {}) {
  const helper = (file, source) => ({
    status: !fs.existsSync(file)
      ? "missing"
      : hash(fs.readFileSync(file)) ===
          hash(fs.readFileSync(new URL(source, import.meta.url)))
        ? "current"
        : "different",
  });
  return {
    suiteVersion: SUITE_VERSION,
    documents: documents.inspectApp(app),
    reasoning: reasoning.inspectApp(app),
    taste: helper(
      path.join(home, ".commandcode/mods/cc-switch-taste.mjs"),
      "../commandcode-taste.mjs",
    ),
    authSync: helper(
      path.join(home, ".commandcode/desktop/sync-auth.mjs"),
      "../commandcode-sync-auth.mjs",
    ),
  };
}
export function prepareSuite(app, bundleDir) {
  return {
    appDir: app,
    documents: documents.prepareInstall(app, bundleDir),
    reasoning: reasoning.prepareInstall(app),
  };
}
export function applySuite(plan, { backupRoot, sign = signApp } = {}) {
  const tasks = [
    [documents, plan.documents],
    [reasoning, plan.reasoning],
  ].filter(([, p]) => !p.unchanged);
  if (!tasks.length) return { unchanged: true };
  const files = Object.assign(
    {},
    ...tasks.map(([adapter, p]) => adapter.transactionFiles(p)),
  );
  return transact({
    app: plan.appDir,
    files,
    label: "extensions",
    backupRoot,
    sign,
    mutate: (ctx) => ({
      suiteVersion: SUITE_VERSION,
      components: tasks.map(([adapter, p]) => adapter.stageInstall(p, ctx)),
    }),
  });
}
