import {
  positiveInteger,
  stringList,
  type KnownModelMetadata,
} from "./modelMetadata";

export type ModelMetadataField = keyof KnownModelMetadata;
export type ModelDialect =
  | "native"
  | "codex"
  | "openclaw"
  | "hermes"
  | "kimi"
  | "omp"
  | "pi"
  | "copilot"
  | "opencode"
  | "mcode"
  | "commandcode"
  | "dsh";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown) =>
  Array.isArray(value) ? (stringList(value) ?? []) : undefined;
const EFFORTS = [
  "off",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Read native fields without inventing support. Empty arrays / false are explicit choices. */
export function modelMetadataFromConfig(
  value: unknown,
  dialect: ModelDialect,
): KnownModelMetadata {
  const model = record(value);
  const limit = record(model.limit);
  const modalities = record(model.modalities);
  const thinking = record(model.thinking);
  let reasoning =
    typeof model.reasoning === "boolean" ? model.reasoning : undefined;
  let efforts = list(model.reasoningEfforts);
  if (dialect === "codex") efforts = list(model.reasoningLevels);
  else if (dialect === "mcode" && efforts === undefined)
    efforts = list(thinking.effortOptions);
  else if (dialect === "dsh") {
    if (model.reasoningEfforts === false) {
      efforts = [];
      reasoning = false;
    } else if (
      model.reasoningEfforts &&
      typeof model.reasoningEfforts === "object"
    )
      efforts = Object.keys(record(model.reasoningEfforts));
  } else if (dialect === "pi" && model.thinkingLevelMap !== undefined) {
    const map = record(model.thinkingLevelMap);
    efforts = EFFORTS.filter((level) =>
      level in map
        ? map[level] !== null
        : ["low", "medium", "high"].includes(level),
    );
  } else if (dialect === "opencode" && model.variants !== undefined) {
    efforts = Object.entries(record(model.variants))
      .filter(
        ([key, variant]) =>
          EFFORTS.includes(key) && record(variant).disabled !== true,
      )
      .map(([key]) => key);
  }
  if (
    efforts !== undefined &&
    (reasoning === undefined || dialect === "commandcode")
  )
    reasoning = efforts.length > 0;
  const capabilities = list(model.capabilities);
  const input =
    dialect === "hermes"
      ? typeof model.supports_vision === "boolean"
        ? model.supports_vision
          ? ["text", "image"]
          : ["text"]
        : undefined
      : dialect === "kimi"
        ? capabilities
          ? capabilities.includes("image_in")
            ? ["text", "image"]
            : ["text"]
          : undefined
        : list(
            model.inputModalities ??
              model.input ??
              model.supportedInputs ??
              modalities.input,
          );
  if (dialect === "kimi" && capabilities !== undefined)
    reasoning =
      capabilities.includes("thinking") ||
      capabilities.includes("always_thinking");
  const metadata: KnownModelMetadata = {
    contextWindow: positiveInteger(
      model.contextWindow ??
        model.context_length ??
        model.max_context_size ??
        model.maxContextWindowTokens ??
        limit.context,
    ),
    maxOutputTokens: positiveInteger(
      model.maxOutputTokens ?? model.maxTokens ?? limit.output,
    ),
    reasoning,
    reasoningEfforts: efforts,
    inputModalities: input,
    outputModalities: list(modalities.output),
  };
  return Object.fromEntries(
    Object.entries(metadata).filter(([, v]) => v !== undefined),
  );
}

export interface ModelMetadataIssue {
  field: ModelMetadataField;
  kind: "missing" | "unknown" | "conflict";
}
export const MODEL_METADATA_FIELDS: ModelMetadataField[] = [
  "contextWindow",
  "maxOutputTokens",
  "reasoning",
  "reasoningEfforts",
  "inputModalities",
  "outputModalities",
];
export const modelFieldsFor = (dialect: ModelDialect): ModelMetadataField[] => {
  if (dialect === "codex")
    return ["contextWindow", "reasoningEfforts", "inputModalities"];
  if (dialect === "hermes") return ["contextWindow", "inputModalities"];
  if (dialect === "kimi")
    return ["contextWindow", "reasoning", "inputModalities"];
  if (dialect === "copilot") return ["contextWindow", "maxOutputTokens"];
  if (dialect === "openclaw")
    return ["contextWindow", "maxOutputTokens", "reasoning", "inputModalities"];
  if (dialect === "omp")
    return ["contextWindow", "maxOutputTokens", "reasoning", "inputModalities"];
  if (dialect === "opencode")
    return MODEL_METADATA_FIELDS.filter(
      (field) => field !== "reasoningEfforts",
    );
  if (dialect === "pi")
    return MODEL_METADATA_FIELDS.filter(
      (field) => field !== "outputModalities",
    );
  return MODEL_METADATA_FIELDS;
};

/** Advisory only. Smaller limits, disabled features and subsets of tiers are valid user restrictions. */
export function inspectModelMetadata(
  current: KnownModelMetadata,
  known: KnownModelMetadata | null,
  fields: readonly ModelMetadataField[] = MODEL_METADATA_FIELDS,
): ModelMetadataIssue[] {
  const issues: ModelMetadataIssue[] = [];
  for (const field of fields) {
    if (
      field === "reasoningEfforts" &&
      (current.reasoning === false || known?.reasoning === false)
    )
      continue;
    const actual = current[field];
    const expected = known?.[field];
    if (actual === undefined) {
      issues.push({
        field,
        kind: expected === undefined ? "unknown" : "missing",
      });
      continue;
    }
    if (expected === undefined) {
      const exceedsContext =
        field === "maxOutputTokens" &&
        typeof actual === "number" &&
        current.contextWindow !== undefined &&
        actual > current.contextWindow;
      issues.push({ field, kind: exceedsContext ? "conflict" : "unknown" });
      continue;
    }
    const tooLarge =
      typeof actual === "number" &&
      ((typeof expected === "number" && actual > expected) ||
        (field === "maxOutputTokens" &&
          current.contextWindow !== undefined &&
          actual > current.contextWindow));
    const unsupported =
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.some((value) => !expected.includes(value));
    if (
      tooLarge ||
      unsupported ||
      (field === "reasoning" && actual === true && expected === false)
    )
      issues.push({ field, kind: "conflict" });
  }
  return issues;
}
