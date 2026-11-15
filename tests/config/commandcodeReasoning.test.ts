import { describe, expect, it } from "vitest";
import type { OpenCodeModel } from "@/types";
import { normalizeCommandCodeModel } from "@/config/commandcodeReasoning";
import {
  commandCodeProviderPresets,
  commandCodeModelDefaults,
  normalizeCommandCodeConfig,
} from "@/config/commandCodeProviderPresets";
import {
  modelSupportsReasoning,
  withModelReasoning,
} from "@/components/providers/forms/helpers/opencodeFormUtils";
import { fillCommandCodeModel } from "@/components/providers/forms/modelMetadataFill";

describe("Command Code native reasoning", () => {
  it("converts the legacy MCode ladder without changing unrelated fields", () => {
    const model = {
      name: "Example",
      reasoning: true,
      thinking: { effortOptions: ["low", "high", "max"] },
      options: { future: "keep" },
      limit: { context: 200000 },
    };
    const saved = normalizeCommandCodeModel(model);
    expect(saved.reasoningEfforts).toEqual(["low", "high", "max"]);
    expect(saved.options).toEqual(model.options);
    expect(saved.limit).toEqual(model.limit);
    expect(model).not.toHaveProperty("reasoningEfforts");
  });

  it("keeps explicit native arrays authoritative, including an empty ladder", () => {
    expect(
      normalizeCommandCodeModel({ reasoning: true, reasoningEfforts: [] }),
    ).toMatchObject({ reasoning: false, reasoningEfforts: [] });
    expect(
      normalizeCommandCodeModel({
        reasoning: false,
        reasoningEfforts: ["max", "low", "off", "max"],
      }),
    ).toMatchObject({ reasoning: true, reasoningEfforts: ["low", "max"] });
  });

  it("treats the native ladder as the switch state and clears it when disabled", () => {
    const model = { name: "Example", reasoningEfforts: ["high", "max"] };
    expect(modelSupportsReasoning(model, "commandcode")).toBe(true);
    expect(withModelReasoning(model, false, "commandcode")).toMatchObject({
      reasoning: false,
      reasoningEfforts: [],
    });
    expect(
      withModelReasoning(
        { name: "Example", reasoningEfforts: [] },
        true,
        "commandcode",
      ),
    ).toMatchObject({
      reasoning: true,
      reasoningEfforts: ["low", "medium", "high"],
    });
  });

  it("fills the exact metadata ladder while preserving explicit opt-out", () => {
    const metadata = {
      reasoning: true,
      reasoningEfforts: ["low", "high", "max"],
    };
    expect(
      fillCommandCodeModel({ name: "New" }, metadata).reasoningEfforts,
    ).toEqual(["low", "high", "max"]);
    expect(
      fillCommandCodeModel({ name: "Example", reasoning: false }, metadata)
        .reasoningEfforts,
    ).toEqual([]);
    expect(
      fillCommandCodeModel({ name: "Example", reasoningEfforts: [] }, metadata)
        .reasoningEfforts,
    ).toEqual([]);
    expect(
      fillCommandCodeModel(
        { name: "Example", reasoningEfforts: ["high"] },
        metadata,
      ).reasoningEfforts,
    ).toEqual(["high"]);
  });

  it("offers known native ladders without inventing unknown model capabilities", () => {
    expect(
      commandCodeModelDefaults("claude-opus-5-5").reasoningEfforts,
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(
      commandCodeModelDefaults("fictional-custom-model").reasoningEfforts,
    ).toBeUndefined();
  });

  it("uses the desktop Claude 5.5 ladder even without a Pi preset", () => {
    expect(
      commandCodeModelDefaults("claude-sonnet-5-5").reasoningEfforts,
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("does not enable an unknown existing model merely by saving", () => {
    const saved = normalizeCommandCodeConfig({
      models: { unknown: { name: "Keep nonreasoning" } },
    });
    expect(saved.models.unknown).toMatchObject({
      reasoning: false,
      reasoningEfforts: [],
    });
  });

  it("writes only native ladders in Command Code presets", () => {
    for (const preset of commandCodeProviderPresets) {
      for (const model of Object.values(preset.settingsConfig.models)) {
        expect(Array.isArray(model.reasoningEfforts)).toBe(true);
        expect(model.reasoning).toBe(
          (model.reasoningEfforts as string[]).length > 0,
        );
      }
    }
    const anthropic = commandCodeProviderPresets.find(
      (p) => p.settingsConfig.models["claude-opus-5-5"],
    );
    expect(
      anthropic?.settingsConfig.models["claude-opus-5-5"].reasoningEfforts,
    ).toContain("max");
  });
});

describe("reviewed GPT reasoning defaults", () => {
  const full = ["low", "medium", "high", "xhigh", "max"];
  it.each([
    "gpt-6.1-sol",
    "gpt-6.1-terra",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-6-astra",
    "openai/gpt-6.1-sol",
  ])(
    "offers every verified native tier for %s without a metadata request",
    (id) => {
      expect(
        commandCodeModelDefaults(id, "https://api.openai.com/v1")
          .reasoningEfforts,
      ).toEqual(full);
      expect(
        commandCodeModelDefaults(id, "https://fictional.invalid/v1")
          .reasoningEfforts,
      ).toEqual(full);
    },
  );
  it("ships the official OpenAI preset with all five tiers", () => {
    const preset = commandCodeProviderPresets.find(
      (p) => p.providerKey === "cc-switch-openai-api",
    )!;
    expect(
      preset.settingsConfig.models["gpt-6.1-sol"].reasoningEfforts,
    ).toEqual(full);
  });
  it.each(
    [["high"], ["low", "medium", "high"], []].map((efforts) => ({ efforts })),
  )(
    "preserves explicit limits $efforts across repeated saves and metadata fill",
    ({ efforts }) => {
      const model = {
        name: "My GPT",
        reasoningEfforts: efforts,
        options: { future: "keep" },
      };
      const config = {
        models: { "gpt-6.1-sol": model },
        options: { baseURL: "https://api.openai.com/v1" },
      };
      const saved = normalizeCommandCodeConfig(config);
      expect(saved.models["gpt-6.1-sol"].reasoningEfforts).toEqual(efforts);
      expect(normalizeCommandCodeConfig(saved)).toEqual(saved);
      expect(
        fillCommandCodeModel(
          model,
          { reasoning: true, reasoningEfforts: full },
          "gpt-6.1-sol",
        ).reasoningEfforts,
      ).toEqual(efforts);
      expect(saved.models["gpt-6.1-sol"].options).toEqual(model.options);
    },
  );
  it("retains explicit off and legacy restrictions for known GPT", () => {
    for (const model of [
      { reasoning: false },
      { thinking: { effortOptions: ["high"] } },
      { variants: { low: {} } },
    ]) {
      const saved = normalizeCommandCodeConfig({
        models: { "gpt-6.1-sol": model as Partial<OpenCodeModel> },
      }).models["gpt-6.1-sol"];
      expect(saved.reasoningEfforts).toEqual(
        "thinking" in model ? ["high"] : "variants" in model ? ["low"] : [],
      );
      expect(
        fillCommandCodeModel(
          { name: "Keep legacy", ...model },
          { reasoning: true, reasoningEfforts: full },
          "gpt-6.1-sol",
        ).reasoningEfforts,
      ).toEqual(saved.reasoningEfforts);
    }
  });
  it("honors resolved endpoint tiers and uses the shared catalog for offline defaults", () => {
    expect(
      fillCommandCodeModel(
        { name: "Custom name" },
        { reasoning: true, reasoningEfforts: ["low", "medium", "high"] },
        "gpt-6.1-sol",
      ),
    ).toMatchObject({
      name: "Custom name",
      reasoning: true,
      reasoningEfforts: ["low", "medium", "high"],
    });
    expect(
      normalizeCommandCodeConfig({
        models: {
          "gpt-6.1-sol": { name: "Custom name" } as Partial<OpenCodeModel>,
        },
      }).models["gpt-6.1-sol"].reasoningEfforts,
    ).toEqual(full);
  });
  it("re-enables known GPT with its native tiers, without widening a current restriction", () => {
    expect(
      withModelReasoning(
        { name: "GPT", reasoning: false, reasoningEfforts: [] },
        true,
        "commandcode",
        "gpt-6.1-sol",
      ).reasoningEfforts,
    ).toEqual(full);
    expect(
      withModelReasoning(
        { name: "GPT", reasoningEfforts: ["high"] },
        true,
        "commandcode",
        "gpt-6.1-sol",
      ).reasoningEfforts,
    ).toEqual(["high"]);
  });
  it("restores legacy limits when reasoning is explicitly re-enabled", () => {
    expect(
      withModelReasoning(
        {
          name: "Legacy GPT",
          reasoning: false,
          reasoningEfforts: [],
          thinking: { effortOptions: ["high"] },
        },
        true,
        "commandcode",
        "gpt-6.1-sol",
      ).reasoningEfforts,
    ).toEqual(["high"]);
    expect(
      withModelReasoning(
        {
          name: "Legacy GPT",
          reasoning: false,
          reasoningEfforts: [],
          variants: { low: {} },
        },
        true,
        "commandcode",
        "gpt-6.1-sol",
      ).reasoningEfforts,
    ).toEqual(["low"]);
  });
  it("does not guess capabilities for unknown future GPT IDs", () => {
    expect(
      commandCodeModelDefaults("gpt-future-unverified").reasoningEfforts,
    ).toBeUndefined();
  });
});
