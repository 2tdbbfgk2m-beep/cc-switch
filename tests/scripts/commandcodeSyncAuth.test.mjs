import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script =
  process.env.COMMANDCODE_AUTH_SYNC_SCRIPT ??
  fileURLToPath(
    new URL("../../scripts/commandcode-sync-auth.mjs", import.meta.url),
  );
function fixture(run) {
  const home = mkdtempSync(path.join(tmpdir(), "commandcode-sync-"));
  const dir = path.join(home, ".commandcode");
  mkdirSync(path.join(dir, "desktop"), { recursive: true });
  const write = (name, value) =>
    writeFileSync(path.join(dir, name), JSON.stringify(value));
  const read = (name) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
  const sync = () =>
    spawnSync(process.execPath, [script], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: "utf8",
    });
  try {
    run({ dir, write, read, sync });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("mirrors key updates and deletions while preserving local login and foreign credentials", () =>
  fixture(({ write, read, sync }) => {
    write("auth.json", {
      apiKey: "source-login",
      mine: { type: "api", key: "new-key" },
    });
    write("auth.local.json", {
      apiKey: "local-login",
      userName: "Keep",
      foreign: { type: "api", key: "unrelated" },
    });
    write("providers.json", { provider: { mine: { models: { x: {} } } } });
    assert.equal(sync().status, 0);
    assert.equal(read("auth.local.json").mine.key, "new-key");
    write("auth.json", { apiKey: "source-login" });
    write("providers.json", { provider: {} });
    assert.equal(sync().status, 0);
    assert.deepEqual(read("auth.local.json"), {
      apiKey: "local-login",
      userName: "Keep",
      foreign: { type: "api", key: "unrelated" },
    });
  }));

test("removes a managed local key when its provider changes to an environment reference", () =>
  fixture(({ write, read, sync }) => {
    write("auth.json", {
      apiKey: "source-login",
      mine: { type: "api", key: "old-key" },
    });
    write("auth.local.json", { apiKey: "local-login" });
    assert.equal(sync().status, 0);
    write("auth.json", { apiKey: "source-login" });
    write("providers.json", {
      providers: { mine: { apiKey: "$PROVIDER_KEY" } },
    });
    assert.equal(sync().status, 0);
    assert.deepEqual(read("auth.local.json"), { apiKey: "local-login" });
  }));

test("a provider definition does not authorize deleting a desktop-only key", () =>
  fixture(({ write, read, sync }) => {
    write("auth.json", { apiKey: "source-login" });
    write("auth.local.json", {
      apiKey: "local-login",
      mine: { type: "api", key: "desktop-only" },
    });
    write("providers.json", { provider: { mine: { models: { x: {} } } } });
    assert.equal(sync().status, 0);
    assert.equal(read("auth.local.json").mine.key, "desktop-only");
  }));

test("malformed source API entries abort instead of being interpreted as deletion", () =>
  fixture(({ dir, write, sync }) => {
    write("auth.json", {
      apiKey: "source-login",
      mine: { type: "api", key: "old-key" },
    });
    assert.equal(sync().status, 0);
    const before = readFileSync(path.join(dir, "auth.local.json"), "utf8");
    for (const entry of [
      { type: "api", key: 123 },
      { type: "api" },
      { type: "api", key: "" },
    ]) {
      write("auth.json", { apiKey: "source-login", mine: entry });
      assert.notEqual(sync().status, 0);
      assert.equal(
        readFileSync(path.join(dir, "auth.local.json"), "utf8"),
        before,
      );
    }
  }));

test("a stale source API key does not overwrite an existing desktop OAuth credential", () =>
  fixture(({ write, read, sync }) => {
    write("auth.json", {
      apiKey: "source-login",
      mine: { type: "api", key: "old-key" },
    });
    const oauth = {
      type: "oauth",
      access: "desktop-oauth",
      refresh: "keep-refresh",
    };
    write("auth.local.json", { apiKey: "local-login", mine: oauth });
    assert.equal(sync().status, 0);
    assert.deepEqual(read("auth.local.json").mine, oauth);
  }));

test("invalid source or local auth aborts without replacing any credentials", () =>
  fixture(({ dir, write, sync }) => {
    write("auth.json", {
      apiKey: "source-login",
      mine: { type: "api", key: "new-key" },
    });
    const local =
      '{"apiKey":"local-login","mine":{"type":"api","key":"old-key"}}';
    writeFileSync(path.join(dir, "auth.local.json"), local);
    writeFileSync(path.join(dir, "auth.json"), "invalid JSON");
    assert.notEqual(sync().status, 0);
    assert.equal(
      readFileSync(path.join(dir, "auth.local.json"), "utf8"),
      local,
    );
    write("auth.json", { apiKey: "source-login" });
    writeFileSync(path.join(dir, "auth.local.json"), "invalid local JSON");
    assert.notEqual(sync().status, 0);
    assert.equal(
      readFileSync(path.join(dir, "auth.local.json"), "utf8"),
      "invalid local JSON",
    );
  }));
