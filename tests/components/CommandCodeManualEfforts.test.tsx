import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { fetchModelsForConfig } from "@/lib/api/model-fetch";
import type { OpenCodeModel } from "@/types";
import { useState } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient as render } from "../utils/testQueryClient";
import { Form } from "@/components/ui/form";
import { OpenCodeFormFields } from "@/components/providers/forms/OpenCodeFormFields";
import { fillCommandCodeModel } from "@/components/providers/forms/modelMetadataFill";
import { normalizeCommandCodeModel } from "@/config/commandcodeReasoning";

vi.mock("@/lib/api/model-fetch", async (original) => ({
  ...(await original<typeof import("@/lib/api/model-fetch")>()),
  fetchModelsForConfig: vi.fn(),
}));
const suggestions = () => [
  {
    baseUrl: "https://fictional.invalid/v1",
    models: new Map([["future-model", { reasoning: true }]]),
  },
];
beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
});
const tiers = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
function Harness({
  empty = false,
  holdManual = false,
  onProposal,
}: {
  empty?: boolean;
  holdManual?: boolean;
  onProposal?: (next: Record<string, OpenCodeModel>) => void;
} = {}) {
  const form = useForm();
  const [models, setModels] = useState<Record<string, OpenCodeModel>>(
    empty ? {} : { "future-model": { name: "Synthetic" } },
  );
  return (
    <Form {...form}>
      <OpenCodeFormFields
        modelDialect="commandcode"
        npm="openai-responses"
        onNpmChange={() => {}}
        apiKey="sk-synthetic"
        presetModelSources={suggestions}
        onApiKeyChange={() => {}}
        shouldShowApiKeyLink={false}
        websiteUrl=""
        baseUrl="https://fictional.invalid/v1"
        onBaseUrlChange={() => {}}
        headers={{}}
        onHeadersChange={() => {}}
        models={models}
        onModelsChange={(next) => {
          onProposal?.(next);
          if (
            holdManual &&
            Array.isArray(next["future-model"]?.reasoningEfforts) &&
            next["future-model"].reasoningEfforts.includes("max")
          )
            return;
          setModels(next);
        }}
        extraOptions={{}}
        onExtraOptionsChange={() => {}}
      />
      <output data-testid="native">{JSON.stringify(models)}</output>
    </Form>
  );
}
describe("manual Command Code reasoning tiers", () => {
  it("offers every candidate for an unknown model and persists precisely the user's subset", async () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("combobox", { name: "future-model 推理档位" }),
    );
    expect(
      screen.queryByRole("option", { name: "ultra" }),
    ).not.toBeInTheDocument();
    for (const tier of tiers)
      expect(screen.getByRole("option", { name: tier })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "minimal" }));
    fireEvent.click(screen.getByRole("option", { name: "max" }));
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("native").textContent!)["future-model"],
      ).toMatchObject({
        reasoning: true,
        reasoningEfforts: ["minimal", "max"],
      }),
    );
    fireEvent.click(screen.getByRole("option", { name: "minimal" }));
    fireEvent.click(screen.getByRole("option", { name: "max" }));
    expect(
      JSON.parse(screen.getByTestId("native").textContent!)["future-model"],
    ).toMatchObject({ reasoning: false, reasoningEfforts: [] });
  });

  it("keeps minimal/ultra through normalization and later metadata fills", () => {
    const model = { name: "m", reasoningEfforts: ["minimal", "ultra"] };
    expect(normalizeCommandCodeModel(model).reasoningEfforts).toEqual([
      "minimal",
      "ultra",
    ]);
    expect(
      fillCommandCodeModel(model, {
        reasoning: true,
        reasoningEfforts: ["low", "high"],
      }).reasoningEfforts,
    ).toEqual(["minimal", "ultra"]);
  });
  it("leaves a new model awaiting manual choices if metadata has no tier list", () => {
    expect(
      fillCommandCodeModel({ name: "m" }, { reasoning: true }),
    ).toMatchObject({ reasoning: false, reasoningEfforts: [] });
    expect(
      normalizeCommandCodeModel({ name: "legacy", reasoning: true })
        .reasoningEfforts,
    ).toEqual(["low", "medium", "high"]);
  });
});

it.each(["subset", "off", "automatic", "delayed-parent"])(
  "keeps %s reasoning choices when metadata arrives after importing a model",
  async (mode) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post("http://tauri.local/fetch_models_dev", async () => {
        await gate;
        return HttpResponse.json(
          JSON.stringify({
            synthetic: {
              api: "https://fictional.invalid/v1",
              models: {
                "future-model": {
                  reasoning: true,
                  reasoning_options: [
                    { type: "effort", values: ["low", "high"] },
                  ],
                  limit: { context: 65536 },
                },
              },
            },
          }),
        );
      }),
    );
    vi.mocked(fetchModelsForConfig).mockResolvedValue([
      { id: "future-model", ownedBy: "synthetic" },
    ]);
    const proposals = vi.fn();
    render(
      <Harness
        empty
        holdManual={mode === "delayed-parent"}
        onProposal={proposals}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "providerForm.fetchModels" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "future-model" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "providerForm.modelPicker.apply",
      }),
    );
    if (mode !== "automatic") {
      fireEvent.click(
        screen.getByRole("combobox", { name: "future-model 推理档位" }),
      );
      fireEvent.click(screen.getByRole("option", { name: "minimal" }));
      if (mode === "off")
        fireEvent.click(screen.getByRole("option", { name: "minimal" }));
      else fireEvent.click(screen.getByRole("option", { name: "max" }));
    }
    release();
    await waitFor(() =>
      expect(
        (mode === "delayed-parent"
          ? proposals.mock.calls.at(-1)?.[0]
          : JSON.parse(screen.getByTestId("native").textContent!))[
          "future-model"
        ].limit?.context,
      ).toBe(65536),
    );
    expect(
      (mode === "delayed-parent"
        ? proposals.mock.calls.at(-1)?.[0]
        : JSON.parse(screen.getByTestId("native").textContent!))["future-model"]
        .reasoningEfforts,
    ).toEqual(
      mode === "subset" || mode === "delayed-parent"
        ? ["minimal", "max"]
        : mode === "off"
          ? []
          : ["low", "high"],
    );
  },
);
