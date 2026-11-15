import type { OpenCodeModel } from "@/types";

// Command Code's providers.json accepts this array, not Pi/DSH maps or MCode options.
export const COMMANDCODE_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const COMMANDCODE_DEFAULT_EFFORTS = ["low", "medium", "high"];

// Reviewed 2026-11-16 against developers.openai.com/api/docs/models/<id>.
// Command Code exposes the five effort tiers below; optional "none" is separate.
const REVIEWED_GPT_IDS = new Set([
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6-astra",
]);
export function reviewedCommandCodeGptEfforts(
  id: string,
): string[] | undefined {
  const bare = id.toLowerCase().replace(/^openai\//, "");
  return REVIEWED_GPT_IDS.has(bare) ? [...COMMANDCODE_EFFORTS] : undefined;
}

export function commandCodeEfforts(values: unknown): string[] {
  return Array.isArray(values)
    ? COMMANDCODE_EFFORTS.filter((level) => values.includes(level))
    : [];
}

export function normalizeCommandCodeModel<T extends Partial<OpenCodeModel>>(
  model: T,
): T & { reasoning: boolean; reasoningEfforts: string[] } {
  const legacyThinking = model.thinking as
    | { effortOptions?: unknown }
    | undefined;
  const variants = model.variants;
  const efforts = Array.isArray(model.reasoningEfforts)
    ? commandCodeEfforts(model.reasoningEfforts)
    : model.reasoning === false
      ? []
      : Array.isArray(legacyThinking?.effortOptions)
        ? commandCodeEfforts(legacyThinking.effortOptions)
        : variants &&
            typeof variants === "object" &&
            Object.keys(variants).some((key) =>
              COMMANDCODE_EFFORTS.includes(
                key as (typeof COMMANDCODE_EFFORTS)[number],
              ),
            )
          ? commandCodeEfforts(Object.keys(variants))
          : model.reasoning === true
            ? [...COMMANDCODE_DEFAULT_EFFORTS]
            : [];
  // Keep unrelated and legacy fields intact for backwards compatibility; this native
  // array is authoritative to Command Code, including [] when explicitly disabled.
  return { ...model, reasoning: efforts.length > 0, reasoningEfforts: efforts };
}
