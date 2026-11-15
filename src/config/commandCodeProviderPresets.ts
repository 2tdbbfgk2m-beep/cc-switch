import type { OpenCodeModel } from "@/types";
import {
  mcodeOnlyPiPresets,
  mcodeProviderPresets,
} from "./mcodeProviderPresets";
import { piProviderPresets } from "./piProviderPresets";
import {
  COMMANDCODE_EFFORTS,
  commandCodeEfforts,
  normalizeCommandCodeModel,
} from "./commandcodeReasoning";

const sources = [...piProviderPresets, ...mcodeOnlyPiPresets];

// Verified against Command Code desktop 0.1.61's embedded catalog. Pi presets
// can lag desktop model releases; these IDs must not silently fall back to 3 tiers.
const nativeClaudeIds = new Set([
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-sonnet-4-6",
]);

export const commandCodeProviderPresets = mcodeProviderPresets.map((preset) => {
  const source = sources.find(
    (item) => item.providerKey === preset.providerKey,
  );
  return {
    ...preset,
    settingsConfig: {
      ...preset.settingsConfig,
      models: Object.fromEntries(
        Object.entries(preset.settingsConfig.models).map(([id, model]) => {
          const reviewed = source?.settingsConfig.models.find(
            (item) => item.id === id,
          );
          const map = reviewed?.thinkingLevelMap;
          const values = nativeClaudeIds.has(id)
            ? [...COMMANDCODE_EFFORTS]
            : model.reasoning && map
              ? COMMANDCODE_EFFORTS.map((level) =>
                  map[level] === undefined
                    ? ["low", "medium", "high"].includes(level)
                      ? level
                      : null
                    : map[level],
                )
              : undefined;
          return [
            id,
            normalizeCommandCodeModel({
              ...model,
              ...(values
                ? { reasoningEfforts: commandCodeEfforts(values) }
                : {}),
            }),
          ];
        }),
      ),
    },
  };
});

/** Local reviewed metadata works even when fetching metadata for a new provider fails. */
function reviewedCommandCodeModel(
  id: string,
  baseUrl?: string,
): OpenCodeModel | undefined {
  if (nativeClaudeIds.has(id.toLowerCase())) {
    return {
      name: id,
      reasoning: true,
      reasoningEfforts: [...COMMANDCODE_EFFORTS],
    };
  }
  const candidates = commandCodeProviderPresets.flatMap((preset) =>
    Object.entries(preset.settingsConfig.models)
      .filter(([key]) => key.toLowerCase() === id.toLowerCase())
      .map(([, model]) => ({
        model,
        endpoint: preset.settingsConfig.options.baseURL,
      })),
  );
  const exact =
    baseUrl &&
    candidates.find(
      (row) => row.endpoint.replace(/\/+$/, "") === baseUrl.replace(/\/+$/, ""),
    );
  const known = exact
    ? exact.model
    : candidates.length &&
        candidates.every(
          (row) =>
            JSON.stringify(row.model.reasoningEfforts) ===
            JSON.stringify(candidates[0].model.reasoningEfforts),
        )
      ? candidates[0].model
      : undefined;
  return known
    ? {
        name: id,
        reasoning: known.reasoning,
        reasoningEfforts: [...(known.reasoningEfforts as string[])],
      }
    : undefined;
}

export function commandCodeModelDefaults(
  id: string,
  baseUrl?: string,
): OpenCodeModel {
  return (
    reviewedCommandCodeModel(id, baseUrl) ??
    normalizeCommandCodeModel({ name: id, reasoning: true })
  );
}

export function normalizeCommandCodeConfig<
  T extends {
    models?: Record<string, Partial<OpenCodeModel>>;
    options?: { baseURL?: string };
  },
>(config: T): T {
  return {
    ...config,
    models: Object.fromEntries(
      Object.entries(config.models ?? {}).map(([id, model]) => {
        const hasExplicit =
          Array.isArray(model.reasoningEfforts) ||
          model.reasoning === false ||
          model.thinking !== undefined ||
          model.variants !== undefined;
        const defaults = hasExplicit
          ? {}
          : (reviewedCommandCodeModel(id, config.options?.baseURL) ?? {});
        return [id, normalizeCommandCodeModel({ ...defaults, ...model })];
      }),
    ),
  };
}
