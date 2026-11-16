import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2),
  at = args.indexOf("--app"),
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-standalone-package-"));
try {
  const archive = fileURLToPath(
    new URL("../release/commandcode-extensions-1.0.0.tar.gz", import.meta.url),
  );
  execFileSync("tar", ["-xzf", archive, "-C", root]);
  const installer = path.join(
    root,
    "scripts/install-commandcode-extensions.mjs",
  );
  const help = execFileSync(process.execPath, [installer, "--help"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(help, /Usage:/);
  if (at >= 0) {
    const app = path.resolve(args[at + 1]);
    const result = JSON.parse(
      execFileSync(process.execPath, [installer, "--dry-run", "--app", app], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    assert.equal(result.compatible, true);
    execFileSync(
      process.execPath,
      [path.join(root, "scripts/test-commandcode-reasoning.mjs"), "--app", app],
      { cwd: root, stdio: "inherit" },
    );
  }
  console.log(
    JSON.stringify({
      standalone: true,
      repositoryRequired: false,
      inferenceRequests: 0,
    }),
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
