// Public, pinned vendor archives only; all inference during verification is synthetic.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hash } from "./commandcode-desktop/transaction.mjs";
const args = process.argv.slice(2),
  value = (key, fallback) =>
    args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const runtimeTest = fileURLToPath(
  new URL("./test-commandcode-reasoning.mjs", import.meta.url),
);
const verify = (app) =>
  execFileSync(process.execPath, [runtimeTest, "--app", app], {
    stdio: "inherit",
  });
if (args.includes("--app")) verify(path.resolve(value("--app")));
else if (!args.includes("--download"))
  throw Error(
    "Supply --app PATH or explicitly allow --download of pinned public archives",
  );
else {
  const cache = path.resolve(
    value("--cache", path.join(os.tmpdir(), "ccs-runtime-cache")),
  );
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
  const { archives } = JSON.parse(
    fs.readFileSync(
      new URL(
        "./commandcode-reasoning/desktop-manifests.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const [version, archive] of Object.entries(archives)) {
    const zip = path.join(cache, "CommandCode-" + version + ".zip");
    if (!fs.existsSync(zip)) {
      const response = await fetch(archive.url);
      if (!response.ok) throw Error("Public archive HTTP " + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (hash(bytes) !== archive.sha256)
        throw Error("Official archive hash mismatch");
      fs.writeFileSync(zip, bytes, { flag: "wx", mode: 0o600 });
    }
    if (hash(fs.readFileSync(zip)) !== archive.sha256)
      throw Error("Cached archive hash mismatch");
    const extracted = fs.mkdtempSync(
      path.join(cache, "extract-" + version + "-"),
    );
    try {
      execFileSync("unzip", ["-q", zip, "-d", extracted], { stdio: "pipe" });
      const app = path.join(extracted, "Command Code.app");
      verify(app);
      if (version === "0.1.61")
        execFileSync(
          process.execPath,
          [
            fileURLToPath(
              new URL("./test-commandcode-package.mjs", import.meta.url),
            ),
            "--app",
            app,
          ],
          { stdio: "inherit" },
        );
      if (version === "0.1.61")
        execFileSync(
          process.execPath,
          [
            fileURLToPath(
              new URL("./test-commandcode-extensions.mjs", import.meta.url),
            ),
            "--app",
            app,
          ],
          { stdio: "inherit" },
        );
    } finally {
      fs.rmSync(extracted, { recursive: true, force: true });
    }
  }
}
