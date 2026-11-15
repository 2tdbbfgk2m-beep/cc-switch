// 把各应用预设里手工核实过的模型参数整理成 `PresetModelSource`，作为表单补全
// 模型参数时的第一优先级（见 `resolveModelMetadata`）。每个应用首次用到时才整理。

import {
  positiveInteger,
  stringList,
  type KnownModelMetadata,
  type PresetModelSource,
} from "@/lib/modelMetadata";
import {
  modelMetadataFromConfig,
  type ModelDialect,
} from "@/lib/modelCapabilities";
import { dshProviderPresets } from "./dshProviderPresets";
import { extractCodexBaseUrl } from "@/utils/providerConfigUtils";
import type { OpenCodeModel } from "@/types";
import { codexProviderPresets } from "./codexProviderPresets";
import { hermesProviderPresets } from "./hermesProviderPresets";
import { kimiProviderPresets } from "./kimiProviderPresets";
import { mcodeProviderPresets } from "./mcodeProviderPresets";
import { commandCodeProviderPresets } from "./commandCodeProviderPresets";
import { openclawProviderPresets } from "./openclawProviderPresets";
import { opencodeProviderPresets } from "./opencodeProviderPresets";
import { piProviderPresets } from "./piProviderPresets";

function compact(metadata: KnownModelMetadata): KnownModelMetadata | null {
  const entries = Object.entries(metadata).filter(
    ([, value]) => value !== undefined,
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as KnownModelMetadata)
    : null;
}

function buildSources<M>(
  endpoints: (string | undefined)[],
  models: Iterable<readonly [string, M]>,
  toMetadata: (model: M) => KnownModelMetadata,
): PresetModelSource[] {
  const map = new Map<string, KnownModelMetadata>();
  for (const [id, model] of models) {
    const metadata = id ? compact(toMetadata(model)) : null;
    if (metadata) map.set(id, metadata);
  }
  if (map.size === 0) return [];
  return [...new Set(endpoints.filter((url): url is string => !!url))].map(
    (baseUrl) => ({ baseUrl, models: map }),
  );
}

function lazy<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= build());
}

export const codexPresetModelSources = lazy(() =>
  codexProviderPresets.flatMap((preset) =>
    buildSources(
      [
        extractCodexBaseUrl(preset.config),
        ...(preset.endpointCandidates ?? []),
      ],
      (preset.modelCatalog ?? []).map((row) => [row.model, row] as const),
      (row) => ({
        contextWindow: positiveInteger(row.contextWindow),
        reasoningEfforts: stringList(row.reasoningLevels),
        inputModalities: stringList(row.inputModalities),
      }),
    ),
  ),
);

export const openclawPresetModelSources = lazy(() =>
  openclawProviderPresets.flatMap((preset) =>
    buildSources(
      [preset.settingsConfig.baseUrl],
      (preset.settingsConfig.models ?? []).map(
        (model) => [model.id, model] as const,
      ),
      (model) => ({
        contextWindow: positiveInteger(model.contextWindow),
        maxOutputTokens: positiveInteger(model.maxTokens),
        reasoning: model.reasoning,
        inputModalities: stringList(model.input),
        cost: model.cost,
      }),
    ),
  ),
);

export const hermesPresetModelSources = lazy(() =>
  hermesProviderPresets.flatMap((preset) =>
    buildSources(
      [preset.settingsConfig.base_url],
      (preset.settingsConfig.models ?? []).map(
        (model) => [model.id, model] as const,
      ),
      (model) => ({ contextWindow: positiveInteger(model.context_length) }),
    ),
  ),
);

const nativeMetadata = (dialect: ModelDialect) => (model: OpenCodeModel) =>
  modelMetadataFromConfig(model, dialect);

export const opencodePresetModelSources = lazy(() =>
  opencodeProviderPresets.flatMap((preset) =>
    buildSources(
      [preset.settingsConfig.options?.baseURL],
      Object.entries(preset.settingsConfig.models ?? {}),
      nativeMetadata("opencode"),
    ),
  ),
);

export const mcodePresetModelSources = lazy(() =>
  mcodeProviderPresets.flatMap((preset) =>
    buildSources(
      [preset.settingsConfig.options.baseURL],
      Object.entries(preset.settingsConfig.models ?? {}),
      nativeMetadata("mcode"),
    ),
  ),
);

export const commandCodePresetModelSources = lazy(() =>
  commandCodeProviderPresets.flatMap((preset) =>
    buildSources(
      [preset.settingsConfig.options.baseURL],
      Object.entries(preset.settingsConfig.models),
      nativeMetadata("commandcode"),
    ),
  ),
);

export const dshPresetModelSources = lazy(() =>
  dshProviderPresets.flatMap((preset) =>
    buildSources(
      [preset.settingsConfig.options.baseURL],
      Object.entries(preset.settingsConfig.models),
      (model) => ({
        ...nativeMetadata("dsh")(model),
        ...(model.reasoningEfforts &&
        typeof model.reasoningEfforts === "object" &&
        !Array.isArray(model.reasoningEfforts)
          ? {
              dshThinking: {
                reasoningEfforts: model.reasoningEfforts as Record<
                  string,
                  string | null
                >,
                api: preset.settingsConfig.api,
                baseUrl: preset.settingsConfig.options.baseURL,
                compat: {
                  ...preset.settingsConfig.compat,
                  ...(model.compat as Record<string, unknown> | undefined),
                },
              },
            }
          : {}),
      }),
    ),
  ),
);

export const piPresetModelSources = lazy(() =>
  piProviderPresets.flatMap((preset) =>
    buildSources(
      [preset.settingsConfig.baseUrl],
      preset.settingsConfig.models.map((model) => [model.id, model] as const),
      (model) => ({
        contextWindow: positiveInteger(model.contextWindow),
        maxOutputTokens: positiveInteger(model.maxTokens),
        reasoning: model.reasoning,
        inputModalities: stringList(model.input),
        piThinking: model.thinkingLevelMap && {
          thinkingLevelMap: model.thinkingLevelMap,
          api: preset.settingsConfig.api,
          baseUrl: preset.settingsConfig.baseUrl,
          compat: model.compat,
        },
      }),
    ),
  ),
);

export const kimiPresetModelSources = lazy(() =>
  kimiProviderPresets.flatMap((preset) =>
    buildSources(
      [preset.settingsConfig.provider.base_url],
      Object.values(preset.settingsConfig.models).map(
        (model) => [model.model, model] as const,
      ),
      (model) => ({
        contextWindow: positiveInteger(model.max_context_size),
        reasoning: model.capabilities?.includes("thinking"),
        inputModalities: model.capabilities?.includes("image_in")
          ? ["text", "image"]
          : undefined,
      }),
    ),
  ),
);

/** Share endpoint-specific limits/modalities across apps, never protocol-dependent thinking maps. */
const sharedPresetModelSources = lazy(() =>
  [
    codexPresetModelSources,
    openclawPresetModelSources,
    hermesPresetModelSources,
    opencodePresetModelSources,
    mcodePresetModelSources,
    commandCodePresetModelSources,
    piPresetModelSources,
    kimiPresetModelSources,
    dshPresetModelSources,
  ].flatMap((sources) =>
    sources().map((source) => ({
      baseUrl: source.baseUrl,
      models: new Map(
        [...source.models].map(([id, model]) => [
          id,
          Object.fromEntries(
            Object.entries(model).filter(
              ([key]) =>
                !["reasoningEfforts", "piThinking", "dshThinking"].includes(
                  key,
                ),
            ),
          ) as KnownModelMetadata,
        ]),
      ),
    })),
  ),
);
export const withSharedPresetModelSources = (
  sources: readonly PresetModelSource[],
) => [...sources, ...sharedPresetModelSources()];
