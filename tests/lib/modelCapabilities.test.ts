import { describe, expect, it } from "vitest";
import {
  modelMetadataFromConfig,
  inspectModelMetadata,
  type ModelDialect,
} from "@/lib/modelCapabilities";
import { resolveModelMetadata } from "@/lib/modelMetadata";

describe("shared native model adapters", () => {
  it.each([
    ["commandcode", { reasoningEfforts: ["low", "max"] }],
    ["mcode", { thinking: { effortOptions: ["low", "max"] } }],
    ["dsh", { reasoningEfforts: { low: "low", max: "max" } }],
    ["opencode", { variants: { low: {}, max: {}, high: { disabled: true } } }],
  ])("reads the actual offered levels from %s", (dialect, config) => {
    expect(
      modelMetadataFromConfig(config, dialect as ModelDialect),
    ).toMatchObject({ reasoningEfforts: ["low", "max"] });
  });
  it("keeps explicit disabled and empty values", () => {
    expect(
      modelMetadataFromConfig(
        { reasoning: false, reasoningEfforts: [] },
        "commandcode",
      ),
    ).toMatchObject({ reasoning: false, reasoningEfforts: [] });
    expect(
      modelMetadataFromConfig({ reasoningEfforts: false }, "dsh"),
    ).toMatchObject({ reasoning: false, reasoningEfforts: [] });
    expect(
      modelMetadataFromConfig({ model: "m", reasoningLevels: [] }, "codex")
        .reasoningEfforts,
    ).toEqual([]);
  });
  it.each([
    ["codex", { contextWindow: "65536", inputModalities: ["text"] }],
    ["openclaw", { contextWindow: 65536, input: ["text"] }],
    ["hermes", { context_length: 65536, supports_vision: false }],
    ["kimi", { max_context_size: 65536, capabilities: ["tool_use"] }],
    ["pi", { contextWindow: 65536, input: ["text"] }],
    ["copilot", { maxContextWindowTokens: 65536, supportedInputs: ["text"] }],
  ])("reads the supported native fields for %s", (dialect, config) => {
    expect(
      modelMetadataFromConfig(config, dialect as ModelDialect).contextWindow,
    ).toBe(65536);
  });
});

describe("shared model configuration inspection", () => {
  it("reports missing, unknown and conflicts without repairing user limits", () => {
    const current = {
      contextWindow: 4096,
      reasoning: false,
      reasoningEfforts: [],
    };
    const known = {
      contextWindow: 65536,
      maxOutputTokens: 8192,
      reasoning: true,
      reasoningEfforts: ["low", "max"],
    };
    expect(
      inspectModelMetadata(current, known, [
        "contextWindow",
        "maxOutputTokens",
        "reasoning",
        "reasoningEfforts",
        "inputModalities",
      ]),
    ).toEqual([
      { field: "maxOutputTokens", kind: "missing" },
      { field: "inputModalities", kind: "unknown" },
    ]);
    expect(current).toEqual({
      contextWindow: 4096,
      reasoning: false,
      reasoningEfforts: [],
    });
  });
  it("flags an excessive output limit and unsupported tiers", () => {
    expect(
      inspectModelMetadata(
        {
          contextWindow: 1024,
          maxOutputTokens: 2048,
          reasoningEfforts: ["max"],
        },
        { maxOutputTokens: 1000, reasoningEfforts: ["low"] },
        ["maxOutputTokens", "reasoningEfforts"],
      ),
    ).toEqual([
      { field: "maxOutputTokens", kind: "conflict" },
      { field: "reasoningEfforts", kind: "conflict" },
    ]);
  });
  it("distinguishes an unknown model from confirmed non-reasoning", () => {
    expect(
      inspectModelMetadata({}, null, ["reasoning", "reasoningEfforts"]),
    ).toEqual([
      { field: "reasoning", kind: "unknown" },
      { field: "reasoningEfforts", kind: "unknown" },
    ]);
    expect(
      inspectModelMetadata({ reasoning: false }, { reasoning: false }, [
        "reasoning",
        "reasoningEfforts",
      ]),
    ).toEqual([]);
  });
});

describe("endpoint identity and capability provenance", () => {
  it("does not mix different local ports", () => {
    expect(
      resolveModelMetadata("future-model", {
        baseUrl: "http://localhost:9001/v1",
        presets: [
          {
            baseUrl: "http://localhost:9002/v1",
            models: new Map([["future-model", { contextWindow: 999999 }]]),
          },
        ],
      }),
    ).toBeNull();
  });
  it("fills from multiple matching sources per field and explains conflicts", () => {
    const result = resolveModelMetadata("future-model", {
      baseUrl: "https://example.com/v1",
      diagnostics: true,
      presets: [
        {
          baseUrl: "https://example.com",
          models: new Map([
            [
              "future-model",
              { contextWindow: 4096, reasoningEfforts: ["low"] },
            ],
          ]),
        },
        {
          baseUrl: "https://example.com",
          models: new Map([
            ["future-model", { contextWindow: 8192, maxOutputTokens: 1024 }],
          ]),
        },
      ],
    });
    expect(result).toMatchObject({
      contextWindow: 4096,
      maxOutputTokens: 1024,
      fieldSources: { contextWindow: "preset", maxOutputTokens: "preset" },
      conflicts: ["contextWindow"],
    });
  });
});

it("uses one offline catalog for every app and honors endpoint restrictions", () => {
  expect(
    resolveModelMetadata("openai/gpt-6.1-sol", {
      baseUrl: "https://unknown.example/v1",
    }),
  ).toMatchObject({
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  });
  expect(
    resolveModelMetadata("gpt-6.1-sol", {
      baseUrl: "https://restricted.example/v1",
      presets: [
        {
          baseUrl: "https://restricted.example/v1",
          models: new Map([["gpt-6.1-sol", { reasoningEfforts: ["high"] }]]),
        },
      ],
    })?.reasoningEfforts,
  ).toEqual(["high"]);
});

it("ignores malformed remote effort descriptors instead of crashing every app", () => {
  expect(() =>
    resolveModelMetadata("future-model", {
      baseUrl: "https://metadata.example/v1",
      modelsDev: {
        example: {
          api: "https://metadata.example/v1",
          models: {
            "future-model": { reasoning_options: { type: "effort" } as never },
          },
        },
      },
    }),
  ).not.toThrow();
});

it("does not infer effort support after an endpoint explicitly disables reasoning", () => {
  const result = resolveModelMetadata("gpt-6.1-sol", {
    baseUrl: "https://disabled.example/v1",
    modelsDev: {
      disabled: {
        api: "https://disabled.example/v1",
        models: { "gpt-6.1-sol": { reasoning: false } },
      },
    },
  });
  expect(result).toMatchObject({ reasoning: false, reasoningEfforts: [] });
});
