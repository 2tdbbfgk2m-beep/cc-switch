import fs from "node:fs";
export const LEVELS = JSON.parse(
  fs.readFileSync(
    new URL("../../src/config/reasoningLevels.json", import.meta.url),
    "utf8",
  ),
);
export const PATCH_VERSION = "1.0.0";
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
  if (hasAll(values(matches[0][2]))) return source;
  return source.replace(
    sdkPattern(kind),
    (_all, before, _list, after) => before + JSON.stringify(LEVELS) + after,
  );
}
export function sourcesSupportAll(sources) {
  return (
    names.every((name) => {
      const matches = [...sources.harness.matchAll(pattern(name))];
      return matches.length === 1 && hasAll(values(matches[0][2]));
    }) &&
    ["openai", "anthropic"].every((kind) => {
      const matches = [...sources[kind].matchAll(sdkPattern(kind))];
      return matches.length === 1 && hasAll(values(matches[0][2]));
    })
  );
}
