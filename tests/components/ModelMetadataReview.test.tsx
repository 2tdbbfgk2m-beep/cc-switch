import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQueryClient as render } from "../utils/testQueryClient";
import { ModelMetadataReview } from "@/components/providers/forms/ModelMetadataReview";

describe("shared configuration review", () => {
  it("shows missing / unknown / conflicting fields, and only fills on request", () => {
    const onFill = vi.fn();
    render(
      <ModelMetadataReview
        dialect="commandcode"
        baseUrl="https://review.example/v1"
        presets={() => [
          {
            baseUrl: "https://review.example/v1",
            models: new Map([
              [
                "future-model",
                {
                  contextWindow: 65536,
                  maxOutputTokens: 8192,
                  reasoning: true,
                  reasoningEfforts: ["low", "max"],
                },
              ],
            ]),
          },
        ]}
        models={[
          {
            key: "row-1",
            id: "future-model",
            value: {
              name: "m",
              limit: { context: 4096 },
              reasoningEfforts: ["turbo"],
            },
          },
        ]}
        onFill={onFill}
      />,
    );
    expect(onFill).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "检查模型配置" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/缺失/)).toBeInTheDocument();
    expect(within(dialog).getAllByText("未知")[0]).toBeInTheDocument();
    expect(within(dialog).getByText("冲突（保留当前值）")).toBeInTheDocument();
    expect(within(dialog).getByText(/low, max/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "补全空字段" }));
    expect(onFill).toHaveBeenCalledWith("row-1", "future-model");
  });
});

it("keeps native-client capability checks read-only", () => {
  render(
    <ModelMetadataReview
      dialect="native"
      baseUrl="https://read.example/v1"
      presets={() => [
        {
          baseUrl: "https://read.example/v1",
          models: new Map([
            ["future-model", { contextWindow: 4096, reasoning: true }],
          ]),
        },
      ]}
      models={[{ key: "main", id: "future-model", value: {} }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "检查模型配置" }));
  expect(
    screen.queryByRole("button", { name: "补全空字段" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "补全全部空字段" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("4096")).toBeInTheDocument();
});

it("checks numeric model IDs instead of treating them as draft placeholders", () => {
  render(
    <ModelMetadataReview
      dialect="commandcode"
      baseUrl="https://numbers.example/v1"
      presets={() => []}
      models={[
        { key: "real-row", id: "model-123", value: { name: "Real model" } },
      ]}
      onFill={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "检查模型配置" }));
  expect(screen.getByRole("region", { name: "model-123" })).toBeInTheDocument();
});
