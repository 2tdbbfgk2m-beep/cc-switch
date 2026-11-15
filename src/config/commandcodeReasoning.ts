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

// Backwards-compatible export; the reviewed catalog is shared by every application.
export { reviewedModelEfforts as reviewedCommandCodeGptEfforts } from "./modelCapabilityCatalog";

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
