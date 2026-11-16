import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { McodeProviderForm } from "@/components/providers/forms/McodeProviderForm";
import { mcodeProviderPresets } from "@/config/mcodeProviderPresets";
import { piProviderPresets } from "@/config/piProviderPresets";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { setProviders } from "../msw/state";
import { createTestQueryClient } from "../utils/testQueryClient";

vi.mock("@/components/JsonEditor", () => ({
  default: ({
    id,
    value,
    onChange,
  }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const render = (ui: ReactElement) =>
  rtlRender(
    <QueryClientProvider client={createTestQueryClient()}>
      {ui}
    </QueryClientProvider>,
  );

const original = {
  kind: "custom",
  api: "anthropic-messages",
  enabled: true,
  options: {
    baseURL: "https://api.example.com/anthropic",
    apiKey: "local-test-key",
    headers: { "X-Test": "keep" },
  },
  models: {
    model: {
      name: "Model",
      limit: { context: 200000 },
      thinking: { effort: "high" },
    },
  },
  futureSetting: { keep: true },
};

describe("McodeProviderForm", () => {
  it("saves Command Code speed tiers per model without changing other options", async () => {
    Element.prototype.scrollIntoView ??= vi.fn();
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <McodeProviderForm
        appId="commandcode"
        providerId="existing"
        initialData={{
          name: "Existing",
          settingsConfig: {
            ...original,
            api: "openai-responses",
            models: {
              model: { name: "GPT", options: { temperature: 0.5 } },
              untouched: { name: "Other", options: { service_tier: "flex" } },
            },
          },
        }}
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Toggle model details" })[0]);
    const speed = screen.getByRole("switch", { name: "Speed mode" });
    expect(speed).not.toBeChecked();
    fireEvent.click(speed);
    const editor = screen.getByLabelText("provider.configJson") as HTMLTextAreaElement;
    expect(JSON.parse(editor.value).models.model.options).toEqual({
      temperature: 0.5,
      service_tier: "fast",
    });
    await user.click(screen.getByRole("combobox", { name: "Speed tier" }));
    await user.click(screen.getByRole("option", { name: "Ultrafast" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const saved = JSON.parse(submit.mock.calls[0][0].settingsConfig);
    expect(saved.models.model.options).toEqual({ temperature: 0.5, service_tier: "ultrafast" });
    expect(saved.models.untouched.options).toEqual({ service_tier: "flex" });
    expect(saved.options).toEqual(original.options);
    expect(saved.futureSetting).toEqual(original.futureSetting);
  });

  it.each(["fast", "priority", "ultrafast"])(
    "reads and disables an existing %s speed tier",
    async (tier) => {
      const submit = vi.fn();
      render(
        <McodeProviderForm
          appId="commandcode"
          providerId="existing"
          initialData={{
            name: "Existing",
            settingsConfig: {
              ...original,
              models: { model: { name: "GPT", options: { temperature: 0.5, service_tier: tier } } },
            },
          }}
          submitLabel="Save"
          onSubmit={submit}
          onCancel={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Toggle model details" }));
      const speed = screen.getByRole("switch", { name: "Speed mode" });
      expect(speed).toBeChecked();
      fireEvent.click(speed);
      expect(speed).not.toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(submit).toHaveBeenCalledOnce());
      expect(JSON.parse(submit.mock.calls[0][0].settingsConfig).models.model.options).toEqual({
        temperature: 0.5,
        service_tier: "default",
      });
    },
  );

  it("reflects JSON tier edits without rewriting an untouched flex tier", async () => {
    const submit = vi.fn();
    render(
      <McodeProviderForm
        appId="commandcode"
        providerId="existing"
        initialData={{ name: "Existing", settingsConfig: original }}
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle model details" }));
    const settings = { ...original, models: { model: { name: "GPT", options: { service_tier: "ultrafast" } } } };
    const editor = screen.getByLabelText("provider.configJson");
    fireEvent.change(editor, { target: { value: JSON.stringify(settings) } });
    expect(screen.getByRole("switch", { name: "Speed mode" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Speed tier" })).toHaveTextContent("Ultrafast");
    settings.models.model.options.service_tier = "flex";
    fireEvent.change(editor, { target: { value: JSON.stringify(settings) } });
    expect(screen.getByRole("switch", { name: "Speed mode" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(JSON.parse(submit.mock.calls[0][0].settingsConfig).models.model.options.service_tier).toBe("flex");
  });

  it.each(["mcode", "dsh"] as const)("hides speed controls for %s", (appId) => {
    render(
      <McodeProviderForm
        appId={appId}
        providerId="existing"
        initialData={{ name: "Existing", settingsConfig: original }}
        submitLabel="Save"
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle model details" }));
    expect(screen.queryByRole("switch", { name: "Speed mode" })).not.toBeInTheDocument();
  });
  it("creates the OpenAI Command Code preset with all reviewed GPT efforts", async () => {
    const submit = vi.fn();
    render(
      <McodeProviderForm
        appId="commandcode"
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "OpenAI API" }));
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "fictional-official-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const saved = JSON.parse(submit.mock.calls[0][0].settingsConfig);
    expect(saved.models["gpt-6.1-sol"].reasoningEfforts).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
  it("keeps an existing GPT provider's explicit three-tier restriction on save", async () => {
    const submit = vi.fn();
    const model = {
      name: "Limited GPT",
      reasoning: true,
      reasoningEfforts: ["low", "medium", "high"],
    };
    render(
      <McodeProviderForm
        appId="commandcode"
        providerId="limited"
        initialData={{
          name: "Limited",
          settingsConfig: {
            ...original,
            api: "openai-responses",
            models: { "gpt-6.1-sol": model },
          },
        }}
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const saved = JSON.parse(submit.mock.calls[0][0].settingsConfig);
    expect(saved.models["gpt-6.1-sol"]).toEqual(model);
    expect(saved.options).toEqual(original.options);
  });

  it("creates a new Command Code provider with native selectable efforts", async () => {
    const submit = vi.fn();
    render(
      <McodeProviderForm
        appId="commandcode"
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "MiniMax" }));
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "fictional-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const saved = JSON.parse(submit.mock.calls[0][0].settingsConfig);
    expect(submit.mock.calls[0][0].providerKey).toBe("cc-switch-mini-max");
    expect(saved.models["MiniMax-M3"].reasoningEfforts.length).toBeGreaterThan(
      0,
    );
    expect(saved.options.apiKey).toBe("fictional-key");
  });
  it("saves Command Code legacy effort options as a native array without changing credentials", async () => {
    const submit = vi.fn();
    render(
      <McodeProviderForm
        appId="commandcode"
        providerId="existing"
        initialData={{
          name: "Existing",
          settingsConfig: {
            ...original,
            models: {
              model: {
                name: "Example",
                reasoning: true,
                thinking: { effortOptions: ["low", "high", "max"] },
              },
            },
          },
        }}
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const saved = JSON.parse(submit.mock.calls[0][0].settingsConfig);
    expect(saved.models.model.reasoningEfforts).toEqual(["low", "high", "max"]);
    expect(saved.options).toEqual(original.options);
    expect(saved.futureSetting).toEqual(original.futureSetting);
  });
  it.each([true, false])(
    "edits native fields while preserving model options and unknown settings (explicit API: %s)",
    async (explicitApi) => {
      const submit = vi.fn();
      const settings: Record<string, unknown> = { ...original };
      if (!explicitApi) delete settings.api;
      render(
        <McodeProviderForm
          appId="mcode"
          providerId="existing"
          initialData={{ name: "Existing", settingsConfig: settings }}
          submitLabel="Save"
          onSubmit={submit}
          onCancel={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText("provider.name"), {
        target: { value: "Renamed" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(submit).toHaveBeenCalledOnce());
      const saved = JSON.parse(submit.mock.calls[0][0].settingsConfig);
      expect(saved).toEqual({ ...settings, name: "Renamed" });
      expect(submit.mock.calls[0][0].providerKey).toBe("existing");
      expect(screen.getByLabelText("API Key")).toHaveAttribute(
        "type",
        "password",
      );
    },
  );

  it("keeps untouched extra option values verbatim when another option is edited", async () => {
    const submit = vi.fn();
    render(
      <McodeProviderForm
        appId="mcode"
        providerId="existing"
        initialData={{
          name: "Existing",
          settingsConfig: {
            kind: "custom",
            api: "anthropic-messages",
            enabled: true,
            options: {
              baseURL: "https://api.example.com/anthropic",
              apiKey: "local-test-key",
              name: "123",
              timeout: 100,
            },
            models: { model: { name: "Model" } },
          },
        }}
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
      />,
    );
    const valueInputs = screen.getAllByPlaceholderText("600000");
    fireEvent.change(valueInputs[valueInputs.length - 1], {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const saved = JSON.parse(submit.mock.calls[0][0].settingsConfig);
    expect(saved.options).toMatchObject({ name: "123", timeout: 200 });
  });

  it("keeps both rows with their types when a rename collides with an existing key", async () => {
    const submit = vi.fn();
    render(
      <McodeProviderForm
        appId="mcode"
        providerId="existing"
        initialData={{
          name: "Existing",
          settingsConfig: {
            kind: "custom",
            api: "anthropic-messages",
            enabled: true,
            options: {
              baseURL: "https://api.example.com/mcode",
              apiKey: "local-test-key",
              target: "100",
              source: 100,
            },
            models: { model: { name: "Model" } },
          },
        }}
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
      />,
    );
    const keyInputs = screen.getAllByPlaceholderText("timeout");
    fireEvent.change(keyInputs[keyInputs.length - 1], {
      target: { value: "target" },
    });
    fireEvent.blur(keyInputs[keyInputs.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const saved = JSON.parse(submit.mock.calls[0][0].settingsConfig);
    expect(saved.options).toMatchObject({ target: "100", source: 100 });
  });

  it("keeps a rejected save open and displays the failure", async () => {
    render(
      <McodeProviderForm
        appId="mcode"
        initialData={{ name: "Existing", settingsConfig: original }}
        submitLabel="Save"
        onSubmit={async () => {
          throw new Error("configuration busy");
        }}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "configuration busy",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("uses the shared preset and model editors and saves native API fields", async () => {
    const submit = vi.fn();
    render(
      <McodeProviderForm
        appId="mcode"
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "MiniMax" }));
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const saved = JSON.parse(submit.mock.calls[0][0].settingsConfig);
    expect(saved.api).toBe("openai-completions");
    expect(saved.options.apiKey).toBe("test-key");
    expect(saved).not.toHaveProperty("npm");
    expect(saved.models).toHaveProperty("MiniMax-M3");
    expect(submit.mock.calls[0][0].providerKey).toBe("cc-switch-mini-max");
  });

  it("requires a well-formed, unused provider key for new providers", async () => {
    setProviders("mcode", {
      taken: { id: "taken", name: "Taken", settingsConfig: original },
    });
    const submit = vi.fn();
    render(
      <McodeProviderForm
        appId="mcode"
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "MiniMax" }));
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "test-key" },
    });
    const key = screen.getByLabelText(/opencode\.providerKey/);
    const save = screen.getByRole("button", { name: "Save" });
    expect(key).toHaveValue("cc-switch-mini-max");
    expect(save).toBeEnabled();

    fireEvent.change(key, { target: { value: "" } });
    expect(save).toBeDisabled();
    fireEvent.change(key, { target: { value: "-bad-" } });
    expect(screen.getByText("opencode.providerKeyInvalid")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(key, { target: { value: "taken" } });
    expect(
      await screen.findByText("opencode.providerKeyDuplicate"),
    ).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.change(key, { target: { value: "My Key!" } });
    expect(key).toHaveValue("mykey");
    fireEvent.click(save);
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0][0].providerKey).toBe("mykey");
  });

  it("keeps provider key composition local until the IME commits", () => {
    render(
      <McodeProviderForm
        appId="mcode"
        submitLabel="Save"
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );
    const key = screen.getByLabelText(/opencode\.providerKey/);

    fireEvent.compositionStart(key);
    fireEvent.change(key, { target: { value: "Te好st" } });
    // The IME still owns the marked text; normalizing it here would replace the
    // composition range and duplicate the typed letters.
    expect(key).toHaveValue("Te好st");

    fireEvent.compositionEnd(key, { data: "Te好st" });
    expect(key).toHaveValue("test");
  });

  it("locks the provider key when editing", () => {
    render(
      <McodeProviderForm
        appId="mcode"
        providerId="existing"
        initialData={{ name: "Existing", settingsConfig: original }}
        submitLabel="Save"
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );
    const key = screen.getByLabelText(/opencode\.providerKey/);
    expect(key).toHaveValue("existing");
    expect(key).toBeDisabled();
    expect(
      screen.getByText("opencode.providerKeyLockedHint"),
    ).toBeInTheDocument();
  });

  it("shows the provider as its custom_provider node in config.yaml", () => {
    render(
      <McodeProviderForm
        appId="mcode"
        providerId="existing"
        initialData={{ name: "Existing", settingsConfig: original }}
        submitLabel="Save"
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );
    const text = (
      screen.getByLabelText(
        "providerForm.nativeConfig.title",
      ) as HTMLTextAreaElement
    ).value;
    expect(text.startsWith("custom_provider:\n  existing:\n")).toBe(true);
    expect(parseYaml(text)).toEqual({
      custom_provider: { existing: original },
    });
  });

  it("follows the provider key typed for a new provider", () => {
    render(
      <McodeProviderForm
        appId="mcode"
        submitLabel="Save"
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/opencode\.providerKey/), {
      target: { value: "acme" },
    });
    expect(
      parseYaml(
        (
          screen.getByLabelText(
            "providerForm.nativeConfig.title",
          ) as HTMLTextAreaElement
        ).value,
      ),
    ).toHaveProperty("custom_provider.acme");
  });

  it.each([
    [
      "broken syntax",
      "custom_provider: [",
      "providerForm.nativeConfig.invalid",
    ],
    [
      "another provider's node",
      "custom_provider:\n  other:\n    kind: custom\n",
      "providerForm.nativeConfig.scope",
    ],
    [
      "a global setting",
      `defaultModel: custom_provider:existing/model\n${stringifyYaml({ custom_provider: { existing: original } })}`,
      "providerForm.nativeConfig.scope",
    ],
    [
      "a field of the wrong type",
      "custom_provider:\n  existing:\n    options:\n      baseURL: 42\n",
      "providerForm.nativeConfig.schema",
    ],
  ])(
    "keeps a YAML draft with %s from breaking the structured fields",
    (_, value, message) => {
      render(
        <McodeProviderForm
          appId="mcode"
          providerId="existing"
          initialData={{ name: "Existing", settingsConfig: original }}
          submitLabel="Save"
          onSubmit={vi.fn()}
          onCancel={() => {}}
        />,
      );
      const editor = screen.getByLabelText("providerForm.nativeConfig.title");
      fireEvent.change(editor, { target: { value } });
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(screen.getByText(message)).toBeInTheDocument();
      fireEvent.change(editor, {
        target: {
          value: stringifyYaml({ custom_provider: { existing: original } }),
        },
      });
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    },
  );

  it("keeps the JSON editor for DeepSeek Harness", () => {
    render(
      <McodeProviderForm
        appId="dsh"
        providerId="existing"
        initialData={{ name: "Existing", settingsConfig: original }}
        submitLabel="Save"
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );
    expect(
      JSON.parse(
        (screen.getByLabelText("provider.configJson") as HTMLTextAreaElement)
          .value,
      ),
    ).toEqual(original);
  });

  it("borrows the MiniMax preset without changing Pi or copying Pi compatibility fields", () => {
    const pi = piProviderPresets.find((preset) => preset.name === "MiniMax")!;
    const mcode = mcodeProviderPresets.find(
      (preset) => preset.name === "MiniMax",
    )!;
    expect(mcode.settingsConfig.options.baseURL).toBe(
      pi.settingsConfig.baseUrl,
    );
    expect(Object.keys(mcode.settingsConfig.models)).toContain("MiniMax-M3");
    expect(mcode.settingsConfig).not.toHaveProperty("compat");
    expect(pi.settingsConfig.models).toBeInstanceOf(Array);
    expect(
      mcodeProviderPresets.every((preset) =>
        [
          "anthropic-messages",
          "openai-completions",
          "openai-responses",
        ].includes(preset.settingsConfig.api),
      ),
    ).toBe(true);
  });
});
