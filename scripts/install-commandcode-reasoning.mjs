#!/usr/bin/env node
import path from "node:path";
import {
  prepareInstall,
  applyInstall,
  removeInstall,
  inspectApp,
  ensureStopped,
  checkUpstream,
} from "./commandcode-reasoning/install.mjs";
const args = process.argv.slice(2);
const at = args.indexOf("--app");
const app = path.resolve(
  at < 0 ? "/Applications/Command Code.app" : args[at + 1],
);
try {
  if (args.includes("--check-upstream"))
    console.log(JSON.stringify(await checkUpstream()));
  else if (args.includes("--check"))
    console.log(JSON.stringify(inspectApp(app)));
  else if (args.includes("--remove")) {
    ensureStopped(app);
    console.log(JSON.stringify(removeInstall(app)));
  } else {
    const plan = prepareInstall(app);
    if (args.includes("--dry-run"))
      console.log(
        JSON.stringify({
          compatible: true,
          unchanged: !!plan.unchanged,
          appVersion: plan.appVersion,
          status: plan.status,
        }),
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
