import {
  resolveModelMetadata,
  type PresetModelSource,
} from "@/lib/modelMetadata";
import { modelMetadataFromConfig } from "@/lib/modelCapabilities";
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
  reviewedCommandCodeGptEfforts,
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
              : model.reasoning
                ? reviewedCommandCodeGptEfforts(id)
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

let nativeSources: PresetModelSource[] | undefined;
/** The same endpoint-aware resolver as every form; no cross-provider consensus heuristic. */
function reviewedCommandCodeModel(
  id: string,
  baseUrl = "",
): OpenCodeModel | undefined {
  nativeSources ??= commandCodeProviderPresets.map((preset) => ({
    baseUrl: preset.settingsConfig.options.baseURL,
    models: new Map(
      Object.entries(preset.settingsConfig.models).map(([key, model]) => [
        key,
        modelMetadataFromConfig(model, "commandcode"),
      ]),
    ),
  }));
  const metadata = resolveModelMetadata(id, {
    baseUrl,
    presets: nativeSources,
  });
  if (metadata?.reasoningEfforts !== undefined)
    return normalizeCommandCodeModel({
      name: id,
      reasoningEfforts: metadata.reasoningEfforts,
    });
  if (metadata?.reasoning === false)
    return { name: id, reasoning: false, reasoningEfforts: [] };
  // Desktop-only capabilities that are absent from the shared API catalog.
  if (nativeClaudeIds.has(id.toLowerCase()))
    return {
      name: id,
      reasoning: true,
      reasoningEfforts: [...COMMANDCODE_EFFORTS],
    };
  return undefined;
}

export function commandCodeModelDefaults(
  id: string,
  baseUrl?: string,
): OpenCodeModel {
  return reviewedCommandCodeModel(id, baseUrl) ?? { name: id };
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
