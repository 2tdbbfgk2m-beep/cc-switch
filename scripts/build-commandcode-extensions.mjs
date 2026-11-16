import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { hash } from "./commandcode-desktop/transaction.mjs";
import {
  SUITE_VERSION,
  validateRelease,
} from "./commandcode-desktop/suite.mjs";
import { PATCH_VERSION as reasoning } from "./commandcode-reasoning/patch.mjs";
import { PATCH_VERSION as documents } from "./commandcode-documents/patch.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
if (!process.argv.includes("--skip-documents"))
  execFileSync(
    process.execPath,
    [path.join(root, "scripts/build-commandcode-documents.mjs")],
    { stdio: "inherit" },
  );
const output = path.join(root, "release/commandcode-extensions");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of [
  "scripts/commandcode-documents",
  "scripts/commandcode-reasoning",
  "scripts/commandcode-desktop",
  "scripts/install-commandcode-extensions.mjs",
  "scripts/install-commandcode-documents.mjs",
  "scripts/install-commandcode-reasoning.mjs",
  "scripts/install-commandcode-taste.mjs",
  "scripts/commandcode-taste.mjs",
  "scripts/commandcode-sync-auth.mjs",
  "scripts/test-commandcode-reasoning.mjs",
  "scripts/test-commandcode-extensions.mjs",
  "src/config/reasoningLevels.json",
  "release/commandcode-documents",
]) {
  const to = path.join(output, file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(path.join(root, file), to, { recursive: true });
}
fs.writeFileSync(
  path.join(output, "README.md"),
  "# Command Code desktop extensions\n\nRequires Node.js 22+, macOS, and audited Command Code 0.1.61 for the combined installer.\n\n1. `node scripts/install-commandcode-extensions.mjs --check`\n2. `node scripts/install-commandcode-extensions.mjs --dry-run`\n3. Quit Command Code; run `node scripts/install-commandcode-extensions.mjs`\n\nThe app transaction preserves providers, auth, preferences and sessions. Taste and auth-sync helpers are checked separately, never silently rewritten. Existing per-component installers remain included.\n\nOffline real-code verification: `node scripts/test-commandcode-reasoning.mjs`. No real fetch is allowed; all inference responses are synthetic.\n\nUltra is local orchestration, separate from API efforts. Existing manual limits remain authoritative. Defaults: 2 concurrent children, 64000 shared token budget per user submission, 8192 output cap. Optional `~/.commandcode/cc-switch-ultra.json` is not created or migrated.\n",
);
const files = {};
for (const name of fs.readdirSync(output, { recursive: true }).sort())
  if (fs.statSync(path.join(output, name)).isFile())
    files[name] = hash(fs.readFileSync(path.join(output, name)));
fs.writeFileSync(
  path.join(output, "suite.json"),
  JSON.stringify(
    {
      owner: "cc-switch-extensions",
      version: SUITE_VERSION,
      components: { documents, reasoning },
      files,
    },
    null,
    2,
  ) + "\n",
);
validateRelease(output);
const archive = path.join(
  root,
  `release/commandcode-extensions-${SUITE_VERSION}.tar.gz`,
);
execFileSync("tar", ["-czf", archive, "-C", output, "."]);
fs.writeFileSync(
  archive + ".sha256",
  hash(fs.readFileSync(archive)) + "  " + path.basename(archive) + "\n",
);
console.log("Built standalone extension package: " + archive);
