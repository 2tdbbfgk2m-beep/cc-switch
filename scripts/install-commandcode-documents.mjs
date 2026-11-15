#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareInstall,
  applyInstall,
  ensureStopped,
  removeInstall,
} from "./commandcode-documents/install.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
try {
  const app = path.resolve(value("--app", "/Applications/Command Code.app"));
  const bundle = path.resolve(
    value(
      "--bundle",
      fileURLToPath(
        new URL("../release/commandcode-documents", import.meta.url),
      ),
    ),
  );
  if (args.includes("--remove")) {
    ensureStopped(app);
    console.log(JSON.stringify(removeInstall(app)));
  } else {
    const plan = prepareInstall(app, bundle);
    if (args.includes("--dry-run"))
      console.log(
        JSON.stringify({ compatible: true, unchanged: !!plan.unchanged, app }),
      );
    else {
      ensureStopped(app);
      console.log(JSON.stringify(applyInstall(plan)));
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
