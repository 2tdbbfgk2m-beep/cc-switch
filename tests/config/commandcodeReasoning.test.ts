import { describe, expect, it } from "vitest";
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

  it("offers a native ladder immediately for new known and custom models", () => {
    expect(
      commandCodeModelDefaults("claude-opus-5-5").reasoningEfforts,
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(
      commandCodeModelDefaults("fictional-custom-model").reasoningEfforts,
    ).toEqual(["low", "medium", "high"]);
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
