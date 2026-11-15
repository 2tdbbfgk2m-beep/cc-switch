import { piModelCatalog } from "./piModelCatalog";
import { normalizeModelsDevModelId } from "@/lib/modelsDev";
import type { KnownModelMetadata } from "@/lib/modelMetadata";

// Shared, offline fallback. Keep reviewed corrections here rather than in each app's form.
// Reviewed 2026-11-16 against developers.openai.com/api/docs/models/<id>.
const REVIEWED_GPT_IDS = new Set([
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6-astra",
]);
export function reviewedModelEfforts(id: string): string[] | undefined {
  return REVIEWED_GPT_IDS.has(id.toLowerCase().replace(/^openai\//, ""))
    ? ["low", "medium", "high", "xhigh", "max"]
    : undefined;
}
const entries = Object.entries(piModelCatalog);
export function catalogModelMetadata(
  id: string,
): KnownModelMetadata | undefined {
  const normalized = normalizeModelsDevModelId(id);
  const candidates = entries.filter(
    ([key]) => normalizeModelsDevModelId(key) === normalized,
  );
  // Ambiguous catalog aliases are unknown; endpoint data can still resolve them.
  const values = candidates.map(([, entry]) => entry.capabilities);
  if (
    !values.length ||
    values.some((value) => JSON.stringify(value) !== JSON.stringify(values[0]))
  )
    return undefined;
  const model = values[0];
  return {
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    reasoning: model.reasoning,
    inputModalities: [...model.input],
  };
}
