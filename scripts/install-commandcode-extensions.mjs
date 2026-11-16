#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectSuite,
  prepareSuite,
  applySuite,
  validateRelease,
} from "./commandcode-desktop/suite.mjs";
import { ensureStopped } from "./commandcode-desktop/transaction.mjs";
import { removeInstall as removeDocuments } from "./commandcode-documents/install.mjs";
import { removeInstall as removeReasoning } from "./commandcode-reasoning/install.mjs";
const args = process.argv.slice(2);
const value = (flag, fallback) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
try {
  const root = fileURLToPath(new URL("..", import.meta.url));
  if (fs.existsSync(path.join(root, "suite.json"))) validateRelease(root);
  if (args.includes("--help"))
    console.log(
      "Usage: node scripts/install-commandcode-extensions.mjs [--app PATH] [--bundle PATH] [--check | --dry-run | --remove --component documents|reasoning]\nDefault installs/updates document and reasoning components in one app transaction. Taste/auth helper status is checked only; use the included Taste installer explicitly if needed.",
    );
  else {
    const app = path.resolve(value("--app", "/Applications/Command Code.app"));
    if (args.includes("--check"))
      console.log(JSON.stringify(inspectSuite(app)));
    else if (args.includes("--remove")) {
      const component = value("--component");
      if (!["documents", "reasoning"].includes(component))
        throw Error("卸载必须指定 --component documents 或 reasoning");
      ensureStopped(app);
      console.log(
        JSON.stringify(
          component === "documents"
            ? removeDocuments(app)
            : removeReasoning(app),
        ),
      );
    } else {
      const bundle = path.resolve(
          value("--bundle", path.join(root, "release/commandcode-documents")),
        ),
        plan = prepareSuite(app, bundle);
      if (args.includes("--dry-run"))
        console.log(
          JSON.stringify({
            compatible: true,
            documentsUnchanged: !!plan.documents.unchanged,
            reasoningUnchanged: !!plan.reasoning.unchanged,
          }),
        );
      else {
        ensureStopped(app);
        console.log(JSON.stringify(applySuite(plan)));
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
