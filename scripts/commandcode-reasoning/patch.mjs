import fs from "node:fs";
export const LEVELS = JSON.parse(
  fs.readFileSync(
    new URL("../../src/config/reasoningLevels.json", import.meta.url),
    "utf8",
  ),
);
export const PATCH_VERSION = "3.0.0";
export const WIRE_LEVELS = LEVELS.filter((level) => level !== "ultra");
const names = [
  "REASONING_EFFORTS",
  "VALID_SKILL_EFFORTS",
  "VALID_REASONING_EFFORTS",
  "VALID_EFFORTS",
];
function pattern(name) {
  return new RegExp(
    `(\\bvar ${name} =\\s*(?:/\\*[^]*?\\*/\\s*)?(?:new Set\\()?\\[)([^]*?)(\\]\\)?;)`,
    "g",
  );
}
function values(body) {
  return [...body.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
}
function hasAll(values) {
  return !!values && LEVELS.every((level) => values.includes(level));
}
function sdkPattern(kind) {
  const property = kind === "openai" ? "reasoningEffort" : "effort";
  return new RegExp(
    `(\\b${property}:\\s*[\\w$]+(?:\\.z)?\\.enum\\()\\[([^\\]]*)\\](\\)\\.optional\\(\\))`,
    "g",
  );
}
export function patchHarness(source) {
  let result = source;
  for (const name of names) {
    const matches = [...result.matchAll(pattern(name))];
    if (matches.length !== 1) throw Error(`未匹配唯一 harness anchor: ${name}`);
    const existing = values(matches[0][2]);
    if (hasAll(existing)) continue;
    const extras = existing.filter(
      (value) => value === "off" || value === "inherit",
    );
    if (existing.some((value) => ![...LEVELS, ...extras].includes(value)))
      throw Error(`未知档位 layout: ${name}`);
    result = result.replace(
      pattern(name),
      (_all, before, _list, after) =>
        before +
        [
          ...extras.filter((x) => x === "off"),
          ...LEVELS,
          ...extras.filter((x) => x === "inherit"),
        ]
          .map((x) => JSON.stringify(x))
          .join(", ") +
        after,
    );
  }
  return result;
}
export function patchSdk(source, kind) {
  const matches = [...source.matchAll(sdkPattern(kind))];
  if (matches.length !== 1) throw Error(`未匹配唯一 SDK anchor: ${kind}`);
  if (JSON.stringify(values(matches[0][2])) === JSON.stringify(WIRE_LEVELS))
    return source;
  return source.replace(
    sdkPattern(kind),
    (_all, before, _list, after) =>
      before + JSON.stringify(WIRE_LEVELS) + after,
  );
}

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw Error("Ultra runtime anchor mismatch: " + before.slice(0, 70));
  return source.replace(before, after);
}
export function patchFullHarness(source) {
  if (source.includes("// CCS_ULTRA_RUNTIME_V3")) return source;
  let result = patchHarness(source);
  result = replaceOnce(
    result,
    "function run(params) {\n  const controller",
    `function run(params) { return ccsUltra.run(params, ccsUltraNativeRun); }\nfunction ccsUltraNativeRun(params) {\n  const controller`,
  );
  result = replaceOnce(
    result,
    "async function runSubAgent(params) {",
    "async function runSubAgent(params) { return ccsUltra.child(params, ccsUltraNativeSubAgent); }\nasync function ccsUltraNativeSubAgent(params) {",
  );
  result = replaceOnce(
    result,
    "if (efforts === void 0 || efforts.length === 0) return null;\n      return efforts;",
    'if (efforts === void 0 || efforts.length === 0) return null;\n      return [...efforts.filter(level=>level!=="ultra"), "ultra"];',
  );
  result = replaceOnce(
    result,
    "complete: async (callParams) => {\n      const owner = resolve12",
    "complete: async (callParams) => {\n      callParams = ccsUltra.normalize(callParams,modelRegistry);\n      callParams = {...callParams, signal:ccsUltra.signal(callParams.signal)};\n      const owner = resolve12",
  );
  result = replaceOnce(
    result,
    "const transport = owner?.transport;\n      if (!owner",
    'const transport = owner?.transport;\n      if(ccsUltra.active() && transport?.kind!=="aisdk") throw new Error("[Ultra] 当前传输不支持逐请求预算控制；请选择普通档位");\n      if (!owner',
  );
  result = replaceOnce(
    result,
    "const requestOnce = async (merged2) => {\n    const messages",
    "const requestOnce = async (merged2) => ccsUltra.request({...callParams, system, tools, providerOptions, messages:[...baseMessages,...merged2],maxOutputTokens,omitMaxOutputTokens:params.omitMaxOutputTokens},async (maxOutputTokens) => {\n    const messages",
  );
  result = replaceOnce(
    result,
    "onFirstEvent: params.onFirstEvent\n    });\n  };\n  const merged",
    "onFirstEvent: params.onFirstEvent\n    });\n  });\n  const merged",
  );
  result = replaceOnce(
    result,
    "  const cost = parseCost(raw.cost, warn, path39);",
    '  if(reasoningEfforts?.length && !reasoningEfforts.includes("ultra")) reasoningEfforts = [...reasoningEfforts,"ultra"];\n  const cost = parseCost(raw.cost, warn, path39);',
  );
  return (
    '// CCS_ULTRA_RUNTIME_V3\nimport {createUltraRuntime} from "../../../../../cc-switch-reasoning/ultra.mjs";\nconst ccsUltra = createUltraRuntime();\n' +
    result
  );
}
