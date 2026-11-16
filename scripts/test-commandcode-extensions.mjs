import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as documents from "./commandcode-documents/install.mjs";
import * as reasoning from "./commandcode-reasoning/install.mjs";
import { prepareSuite, applySuite } from "./commandcode-desktop/suite.mjs";
import { hash } from "./commandcode-desktop/transaction.mjs";
import { desktop } from "./commandcode-documents/patch.mjs";
const args = process.argv.slice(2),
  at = args.indexOf("--app");
const source = path.resolve(
  at < 0 ? "/Applications/Command Code.app" : args[at + 1],
);
const bundle = fileURLToPath(
    new URL("../release/commandcode-documents", import.meta.url),
  ),
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-coexistence-"));
const backupRoot = path.join(root, "backups");
const copy = (from, to) => execFileSync("ditto", [from, to], { stdio: "pipe" });
const verify = (app) =>
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
    stdio: "pipe",
  });
const state = (app) =>
  Object.fromEntries(
    [
      "Contents/Resources/app/out/renderer/assets/" + desktop.renderer,
      ...Object.values(reasoning.TARGETS).map((t) => t.path),
      "Contents/MacOS/Command Code",
      "Contents/_CodeSignature/CodeResources",
    ]
      .filter((p) => fs.existsSync(path.join(app, p)))
      .map((p) => [p, hash(fs.readFileSync(path.join(app, p)))]),
  );
try {
  globalThis.fetch = async () => {
    throw Error("Network forbidden in coexistence tests");
  };
  const baseline = path.join(root, "Base.app");
  copy(source, baseline);
  for (
    let i = 0;
    i < 8 && reasoning.inspectApp(baseline).status !== "needs-extension";
    i++
  )
    reasoning.removeInstall(baseline, { backupRoot });
  assert.equal(reasoning.inspectApp(baseline).status, "needs-extension");
  if (documents.inspectApp(baseline).status === "patched")
    documents.removeInstall(baseline, { backupRoot });
  verify(baseline);
  const records = [];
  for (const order of [
    ["documents", "reasoning"],
    ["reasoning", "documents"],
  ]) {
    const app = path.join(root, order[0] + ".app");
    copy(baseline, app);
    const plan = prepareSuite(app, bundle);
    assert.ok(!plan.documents.unchanged && !plan.reasoning.unchanged);
    const installed = applySuite(plan, { backupRoot });
    assert.equal(installed.result.components.length, 2);
    verify(app);
    assert.equal(documents.inspectApp(app).status, "patched");
    assert.equal(reasoning.inspectApp(app).status, "patched");
    for (const name of order) {
      (name === "documents" ? documents : reasoning).removeInstall(app, {
        backupRoot,
      });
      verify(app);
      const other = order.find((n) => n !== name);
      if (name === order[0])
        assert.equal(
          (other === "documents" ? documents : reasoning).inspectApp(app)
            .status,
          "patched",
        );
    }
    assert.equal(documents.inspectApp(app).status, "needs-extension");
    assert.equal(reasoning.inspectApp(app).status, "needs-extension");
    records.push(order.join(" → "));
  }
  for (const failure of ["second-stage", "sign"]) {
    const app = path.join(root, failure + ".app");
    copy(baseline, app);
    const before = state(app),
      plan = prepareSuite(app, bundle);
    if (failure === "second-stage")
      plan.reasoning.originalHashes.harness = "synthetic-mismatch";
    assert.throws(
      () =>
        applySuite(plan, {
          backupRoot,
          ...(failure === "sign"
            ? {
                sign: () => {
                  throw Error("synthetic sign failure");
                },
              }
            : {}),
        }),
      failure === "sign" ? /sign failure/ : /预检后变化/,
    );
    assert.deepEqual(state(app), before);
    assert.equal(documents.inspectApp(app).status, "needs-extension");
    assert.equal(reasoning.inspectApp(app).status, "needs-extension");
    verify(app);
  }
  console.log(
    JSON.stringify({
      orders: records,
      rollback: ["second-stage", "sign"],
      realSignaturesVerified: true,
      networkCalls: 0,
    }),
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
