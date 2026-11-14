// Mirrors CC Switch's BYOK keys into Command Code's local desktop environment.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.join(os.homedir(), ".commandcode");
const statePath = path.join(dir, "desktop", "auth-sync-state.json");

function read(file, missing) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${file}: expected a JSON object; nothing was changed`);
    }
    return value;
  } catch (error) {
    if (error.code === "ENOENT" && missing !== undefined) return missing;
    if (error instanceof SyntaxError)
      throw new Error(`${file}: invalid JSON; nothing was changed`);
    throw error;
  }
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Read and validate every input before changing credentials. A broken source
// must never be treated as an empty map of keys to remove.
const auth = read(path.join(dir, "auth.json"));
const localPath = path.join(dir, "auth.local.json");
const local = read(localPath, {});
const configPath = path.join(dir, "config.local.json");
const config = read(configPath, {});
const state = read(statePath, { managedProviderIds: [] });
if (
  !Array.isArray(state.managedProviderIds) ||
  !state.managedProviderIds.every((id) => typeof id === "string")
) {
  throw new Error("Invalid Command Code auth sync state; nothing was changed");
}
const apiEntries = Object.entries(auth).filter(
  ([, entry]) => entry?.type === "api",
);
if (
  apiEntries.some(
    ([, entry]) => typeof entry.key !== "string" || !entry.key.trim(),
  )
) {
  throw new Error("Invalid source API credential; nothing was changed");
}
const entries = apiEntries.filter(
  ([id]) => !local[id]?.type || local[id].type === "api",
);
const managed = new Set([
  ...state.managedProviderIds,
  ...entries.map(([id]) => id),
]);
const before = JSON.stringify(local);
const active = new Set(entries.map(([id]) => id));
for (const id of managed) {
  // Never delete local OAuth credentials or unrelated account fields.
  if (!active.has(id) && local[id]?.type === "api") delete local[id];
}
for (const [id, entry] of entries) {
  if (JSON.stringify(local[id]) !== JSON.stringify(entry)) local[id] = entry;
}
if (!local.apiKey) local.apiKey = "cc-switch-local-only";
if (JSON.stringify(local) !== before) write(localPath, local);
if (config.localOnly !== true)
  write(configPath, { ...config, localOnly: true });
// Keep deleted ids so a failed/retried sync can still retire their stale keys.
const ids = [...managed].sort();
if (JSON.stringify(ids) !== JSON.stringify(state.managedProviderIds)) {
  write(statePath, { managedProviderIds: ids });
}
