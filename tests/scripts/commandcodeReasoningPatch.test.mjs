import { test } from "node:test";
import assert from "node:assert/strict";
import {
  patchHarness,
  patchSdk,
  sourcesSupportAll,
} from "../../scripts/commandcode-reasoning/patch.mjs";
const five = '"low", "medium", "high", "xhigh", "max"';
const source = `var REASONING_EFFORTS = /* @__PURE__ */ new Set(["off",${five}]);\nvar VALID_SKILL_EFFORTS = new Set([${five},"inherit"]);\nvar VALID_REASONING_EFFORTS = ["off",${five}];\nvar VALID_EFFORTS = new Set([${five}]);\nvar DEFAULT_REASONING_EFFORTS=["low","medium","high"];`;
const openai =
  'reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),';
const anthropic = `effort: z.enum([${five}]).optional(),`;
const all = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];
test("extends every validation path without changing builtin model recommendations", () => {
  const patched = patchHarness(source);
  const values = new Function(
    patched +
      ";return {REASONING_EFFORTS,VALID_SKILL_EFFORTS,VALID_REASONING_EFFORTS,VALID_EFFORTS,DEFAULT_REASONING_EFFORTS}",
  )();
  for (const level of all)
    for (const name of [
      "REASONING_EFFORTS",
      "VALID_SKILL_EFFORTS",
      "VALID_REASONING_EFFORTS",
      "VALID_EFFORTS",
    ])
      assert.ok(Array.from(values[name]).includes(level), `${name}:${level}`);
  assert.deepEqual(values.DEFAULT_REASONING_EFFORTS, ["low", "medium", "high"]);
  assert.equal(patchHarness(patched), patched);
});
test("extends SDK effort validation, and recognizes an upstream that already supports all tiers", () => {
  const patched = {
    harness: patchHarness(source),
    openai: patchSdk(openai, "openai"),
    anthropic: patchSdk(anthropic, "anthropic"),
  };
  assert.equal(
    sourcesSupportAll({ harness: source, openai, anthropic }),
    false,
  );
  assert.equal(sourcesSupportAll(patched), true);
  assert.equal(patchSdk(patched.openai, "openai"), patched.openai);
});
test("refuses an unknown validation layout rather than patching unrelated model data", () => {
  assert.throws(
    () => patchHarness('const model={reasoningEfforts:["low","high"]}'),
    /匹配|layout|anchor/i,
  );
  assert.throws(
    () => patchSdk('const effort="high"', "openai"),
    /匹配|layout|anchor/i,
  );
});
