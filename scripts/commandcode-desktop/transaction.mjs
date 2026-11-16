import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
export const hash = (data) =>
  crypto.createHash("sha256").update(data).digest("hex");
export const SIGNATURES = [
  "Contents/MacOS/Command Code",
  "Contents/_CodeSignature/CodeResources",
];
const ensure = (ok, message) => {
  if (!ok) throw Error(message);
};
const safeRelative = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  !path.isAbsolute(name) &&
  !name.split(/[\\/]/).includes("..");
function target(app, relative) {
  ensure(safeRelative(relative), "无效事务路径");
  const file = path.join(app, relative);
  let parent = file;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  ensure(
    fs.realpathSync(parent).startsWith(fs.realpathSync(app) + path.sep) ||
      fs.realpathSync(parent) === fs.realpathSync(app),
    "事务路径不在应用内",
  );
  return file;
}
function treeHashes(file) {
  let info;
  try {
    info = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  ensure(!info.isSymbolicLink(), "事务文件不能为符号链接");
  if (info.isFile()) return { "": hash(fs.readFileSync(file)) };
  ensure(info.isDirectory(), "不支持的事务文件类型");
  const result = {};
  for (const entry of fs.readdirSync(file).sort()) {
    const child = treeHashes(path.join(file, entry));
    for (const [key, digest] of Object.entries(child))
      result[path.posix.join(entry, key)] = digest;
  }
  return result;
}
export function signApp(app) {
  execFileSync(
    "codesign",
    [
      "--force",
      "--sign",
      "-",
      "--preserve-metadata=identifier,entitlements,flags,runtime",
      app,
    ],
    { stdio: "pipe" },
  );
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
    stdio: "pipe",
  });
}
export function ensureStopped(app) {
  const expression = path
    .join(app, "Contents/MacOS/Command Code")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    execFileSync("pgrep", ["-f", expression], { stdio: "pipe" });
  } catch (error) {
    if (error.status === 1) return;
    throw error;
  }
  throw Error("请先退出 Command Code；配置和会话不会被修改。");
}
export function restoreSnapshot(app, backupDir, { files } = {}) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(backupDir, "transaction.json"), "utf8"),
  );
  ensure(manifest.schema === 1, "未知备份格式");
  for (const [name, entry] of Object.entries(manifest.files)) {
    ensure(safeRelative(name), "无效备份路径");
    target(app, entry.relative);
    ensure(
      JSON.stringify(treeHashes(path.join(backupDir, name))) ===
        JSON.stringify(entry.hashes),
      "备份校验失败，未修改应用",
    );
  }
  ensure(files && Object.keys(files).length, "恢复必须指定归属文件");
  const selected = Object.keys(files);
  for (const name of selected)
    ensure(
      Object.hasOwn(manifest.files, name) &&
        manifest.files[name].relative === files[name],
      "恢复文件归属校验失败",
    );
  for (const name of selected) {
    const entry = manifest.files[name],
      file = target(app, entry.relative);
    fs.rmSync(file, { recursive: true, force: true });
    if (entry.hashes !== null) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.cpSync(path.join(backupDir, name), file, { recursive: true });
    }
  }
}
export function transact({
  app,
  files,
  label,
  mutate,
  backupRoot = path.join(os.homedir(), ".commandcode/desktop-backups"),
  sign = signApp,
}) {
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  ensure(
    !fs.lstatSync(backupRoot).isSymbolicLink(),
    "备份根目录不能为符号链接",
  );
  const lock = path.join(
    backupRoot,
    hash(fs.realpathSync(app)).slice(0, 16) + ".lock",
  );
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error("另一个桌面扩展事务尚未结束；未修改应用");
    throw error;
  }
  let backupDir;
  try {
    const all = {
      ...files,
      ...Object.fromEntries(SIGNATURES.map((p) => [p, p])),
    };
    for (const [name, relative] of Object.entries(all)) {
      ensure(
        safeRelative(name) && name !== "transaction.json",
        "无效备份文件名",
      );
      target(app, relative);
    }
    backupDir = fs.mkdtempSync(path.join(backupRoot, label + "-"));
    const manifest = { schema: 1, files: {} };
    for (const [name, relative] of Object.entries(all)) {
      const file = target(app, relative),
        hashes = treeHashes(file);
      manifest.files[name] = { relative, hashes };
      if (hashes !== null) {
        const to = path.join(backupDir, name);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.cpSync(file, to, { recursive: true });
      }
    }
    fs.writeFileSync(
      path.join(backupDir, "transaction.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 },
    );
    try {
      const result = mutate({ backupDir });
      sign(app);
      return { result, backupDir };
    } catch (error) {
      try {
        restoreSnapshot(app, backupDir, { files: all });
      } catch (rollback) {
        throw new AggregateError(
          [error, rollback],
          "桌面事务失败且恢复失败；保留备份供核对",
        );
      }
      throw error;
    }
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
