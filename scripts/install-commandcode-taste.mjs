import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function installTaste({ home = os.homedir() } = {}) {
  const dir = path.join(home, ".commandcode", "mods");
  for (const folder of [path.dirname(dir), dir]) {
    try {
      if ((await fs.lstat(folder)).isSymbolicLink())
        throw new Error("Refusing a symlinked Mod installation directory");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const target = path.join(dir, "cc-switch-taste.mjs");
  const source = await fs.readFile(
    new URL("./commandcode-taste.mjs", import.meta.url),
    "utf8",
  );
  let previous;
  try {
    if ((await fs.lstat(target)).isSymbolicLink())
      throw new Error("Refusing a symlinked Mod file");
    previous = await fs.readFile(target, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (previous === source) return { target, changed: false };
  if (
    previous &&
    !previous.startsWith(
      "// Desktop Mod: use the existing Go credential for the native Taste learner.",
    )
  ) {
    throw new Error(
      "Existing cc-switch-taste.mjs is not this Mod; nothing was replaced",
    );
  }
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (previous !== undefined) {
    const hash = createHash("sha256").update(previous).digest("hex");
    // Exclusive sibling backup: never overwrite an existing backup or any config.
    try {
      await fs.writeFile(`${target}.${hash}.backup`, previous, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, source, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true });
  }
  return { target, changed: true };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const result = await installTaste();
  console.log(
    `${result.changed ? "Installed" : "Already installed"}: ${result.target}`,
  );
  console.log(
    "Reload desktop Mods or open a new session to load it. Config, login, main model and sessions were not changed.",
  );
}
