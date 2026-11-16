import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyInstall,
  inspectApp,
  prepareInstall,
  removeInstall,
  TARGETS,
  hash,
} from "../../scripts/commandcode-reasoning/install.mjs";
const five = '"low", "medium", "high", "xhigh", "max"';
const source = `var REASONING_EFFORTS = new Set(["off",${five}]);var VALID_SKILL_EFFORTS = new Set([${five},"inherit"]);var VALID_REASONING_EFFORTS = ["off",${five}];var VALID_EFFORTS = new Set([${five}]);`;
const runtimeAnchors = `
  const cost = parseCost(raw.cost, warn, path39);
function run(params) {
  const controller = new AbortController();
}
async function runSubAgent(params) {}
if (efforts === void 0 || efforts.length === 0) return null;
      return efforts;
complete: async (callParams) => {
      const owner = resolve12(model);
const transport = owner?.transport;
      if (!owner) {}
const requestOnce = async (merged2) => {
    const messages = [];
onFirstEvent: params.onFirstEvent
    });
  };
  const merged = [];
`;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-efforts-install-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "App.app");
  const write = (relative, value) => {
    const p = path.join(app, relative);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, value);
  };
  write("Contents/Resources/app/package.json", '{"version":"0.1.61"}');
  for (const [id, target] of Object.entries(TARGETS))
    write(
      target.path,
      id === "harness"
        ? source + runtimeAnchors
        : id.startsWith("openai")
          ? 'reasoningEffort: z.enum(["none","minimal","low","medium","high","xhigh"]).optional(),'
          : `effort: z.enum([${five}]).optional(),`,
    );
  for (const file of [
    "Contents/MacOS/Command Code",
    "Contents/_CodeSignature/CodeResources",
    "Contents/Resources/app/out/renderer/assets/existing-docs.js",
  ])
    write(file, "unchanged");
  const trusted = {
    "0.1.61": Object.fromEntries(
      Object.entries(TARGETS).map(([id, target]) => [
        id,
        hash(fs.readFileSync(path.join(app, target.path))),
      ]),
    ),
  };
  return { root, app, trusted, backupRoot: path.join(root, "backups") };
}
test("installation is idempotent and removal restores exact originals including signatures", (t) => {
  const x = fixture(t);
  const original = fs.readFileSync(path.join(x.app, TARGETS.harness.path));
  const plan = prepareInstall(x.app, { trusted: x.trusted });
  applyInstall(plan, { backupRoot: x.backupRoot, sign: () => {} });
  assert.equal(inspectApp(x.app).status, "patched");
  assert.equal(prepareInstall(x.app, { trusted: x.trusted }).unchanged, true);
  removeInstall(x.app, { verify: () => {} });
  assert.deepEqual(
    fs.readFileSync(path.join(x.app, TARGETS.harness.path)),
    original,
  );
  assert.equal(
    fs.readFileSync(
      path.join(
        x.app,
        "Contents/Resources/app/out/renderer/assets/existing-docs.js",
      ),
      "utf8",
    ),
    "unchanged",
  );
});
test("a signing failure rolls back all source and signature files", (t) => {
  const x = fixture(t);
  const before = fs.readFileSync(path.join(x.app, TARGETS.harness.path));
  assert.throws(
    () =>
      applyInstall(prepareInstall(x.app, { trusted: x.trusted }), {
        backupRoot: x.backupRoot,
        sign: (app) => {
          fs.writeFileSync(
            path.join(app, "Contents/MacOS/Command Code"),
            "partially signed",
          );
          throw Error("sign failed");
        },
      }),
    /sign failed/,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(x.app, TARGETS.harness.path)),
    before,
  );
  assert.equal(
    fs.readFileSync(path.join(x.app, "Contents/MacOS/Command Code"), "utf8"),
    "unchanged",
  );
});
test("unknown or changed upstream files are refused before mutation", (t) => {
  const x = fixture(t);
  fs.appendFileSync(path.join(x.app, TARGETS.harness.path), "\nmodified");
  assert.throws(
    () => prepareInstall(x.app, { trusted: x.trusted }),
    /校验|变化|未知/,
  );
});
test("removal verification failure restores the still-working extension", (t) => {
  const x = fixture(t);
  applyInstall(prepareInstall(x.app, { trusted: x.trusted }), {
    backupRoot: x.backupRoot,
    sign: () => {},
  });
  const patched = fs.readFileSync(path.join(x.app, TARGETS.harness.path));
  assert.throws(
    () =>
      removeInstall(x.app, {
        verify: () => {
          throw Error("verification failed");
        },
      }),
    /verification failed/,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(x.app, TARGETS.harness.path)),
    patched,
  );
  assert.equal(inspectApp(x.app).status, "patched");
});
test("does not mistake eight native validation strings for a verified orchestration implementation", async (t) => {
  const x = fixture(t);
  const { patchHarness, patchSdk } = await import(
    "../../scripts/commandcode-reasoning/patch.mjs"
  );
  fs.writeFileSync(
    path.join(x.app, "Contents/Resources/app/package.json"),
    '{"version":"0.1.99"}',
  );
  for (const [id, target] of Object.entries(TARGETS)) {
    const file = path.join(x.app, target.path);
    const source = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      file,
      id === "harness" ? patchHarness(source) : patchSdk(source, target.kind),
    );
  }
  assert.throws(() => prepareInstall(x.app), /未知/);
});
test("reports unaudited upstream releases as unknown instead of claiming support", async () => {
  const { checkUpstream } = await import(
    "../../scripts/commandcode-reasoning/install.mjs"
  );
  const release = (version) => async () => ({
    ok: true,
    json: async () => ({
      tag_name: version,
      html_url: "https://github.com/CommandCodeAI/desktop/releases",
    }),
  });
  assert.deepEqual((await checkUpstream(release("v0.1.62"))).nativeEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  const future = await checkUpstream(release("v0.1.99"));
  assert.equal(future.nativeEfforts, null);
  assert.equal(future.codeAudited, false);
});

for (const failSigning of [false, true])
  test(
    failSigning
      ? "failed v1 upgrade restores exact manifest sources and signatures"
      : "upgrades the managed v1 extension and restores it exactly when v2 is removed",
    async (t) => {
      const x = fixture(t);
      const { patchHarness } = await import(
        "../../scripts/commandcode-reasoning/patch.mjs"
      );
      const original = fs.readFileSync(
        path.join(x.app, TARGETS.harness.path),
        "utf8",
      );
      applyInstall(prepareInstall(x.app, { trusted: x.trusted }), {
        backupRoot: x.backupRoot,
        sign: () => {},
      });
      const installedFile = path.join(
        x.app,
        "Contents/Resources/cc-switch-reasoning/installed.json",
      );
      const m = JSON.parse(fs.readFileSync(installedFile));
      m.patchVersion = "1.0.0";
      fs.writeFileSync(
        path.join(x.app, TARGETS.harness.path),
        patchHarness(original),
      );
      for (const [id, target] of Object.entries(TARGETS))
        m.patchedHashes[id] = hash(
          fs.readFileSync(path.join(x.app, target.path)),
        );
      fs.writeFileSync(installedFile, JSON.stringify(m, null, 2));
      const before = fs.readFileSync(installedFile, "utf8");
      const plan = prepareInstall(x.app, { trusted: x.trusted });
      assert.equal(plan.previousManifest, before);
      if (failSigning) {
        const previousSource = fs.readFileSync(
          path.join(x.app, TARGETS.harness.path),
        );
        assert.throws(
          () =>
            applyInstall(plan, {
              backupRoot: x.backupRoot,
              sign: (app) => {
                fs.writeFileSync(
                  path.join(app, "Contents/MacOS/Command Code"),
                  "partially signed",
                );
                throw Error("upgrade sign failure");
              },
            }),
          /upgrade sign failure/,
        );
        assert.equal(fs.readFileSync(installedFile, "utf8"), before);
        assert.deepEqual(
          fs.readFileSync(path.join(x.app, TARGETS.harness.path)),
          previousSource,
        );
        assert.equal(
          fs.readFileSync(
            path.join(x.app, "Contents/MacOS/Command Code"),
            "utf8",
          ),
          "unchanged",
        );
        assert.equal(inspectApp(x.app).status, "upgrade-required");
        return;
      }
      applyInstall(plan, { backupRoot: x.backupRoot, sign: () => {} });
      assert.equal(inspectApp(x.app).status, "patched");
      // Recover the oldest official source, then unwind each signed state.
      const intermediate = JSON.parse(fs.readFileSync(installedFile, "utf8"));
      intermediate.patchVersion = "2.0.0";
      const intermediateText = JSON.stringify(intermediate, null, 2);
      fs.writeFileSync(installedFile, intermediateText);
      applyInstall(prepareInstall(x.app, { trusted: x.trusted }), {
        backupRoot: x.backupRoot,
        sign: () => {},
      });
      removeInstall(x.app, { verify: () => {} });
      assert.equal(fs.readFileSync(installedFile, "utf8"), intermediateText);
      assert.equal(inspectApp(x.app).status, "upgrade-required");
      removeInstall(x.app, { verify: () => {} });
      assert.equal(fs.readFileSync(installedFile, "utf8"), before);
      assert.equal(inspectApp(x.app).status, "upgrade-required");
      removeInstall(x.app, { verify: () => {} });
      assert.equal(
        fs.readFileSync(path.join(x.app, TARGETS.harness.path), "utf8"),
        original,
      );
    },
  );
