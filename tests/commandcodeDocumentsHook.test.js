import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  desktop,
  patchRenderer,
} from "../scripts/commandcode-documents/patch.mjs";

function hook(convert) {
  const m = desktop.markers;
  const fixture = `${m.modelRead}\n${m.batch}\n${m.inlineCondition}x}\n${desktop.imageHook}\n${m.imageHookUse}\n${m.apply}`;
  const patched = patchRenderer(fixture);
  const source = patched.slice(
    patched.indexOf("function BY("),
    patched.indexOf("\n{imageCountRef:ccDocImageCount"),
  );
  return new Function("u", "HY", "_g", "LY", "PY", `${source};return BY`)(
    React,
    convert,
    8,
    vi.fn(),
    vi.fn(),
  );
}
const file = (name) => new File(["fake image"], name, { type: "image/png" });
const image = async (file) => ({
  name: file.name,
  dataUrl: "same pixels",
  historyDataUrl: "same pixels",
});
async function ingest(result, files) {
  let pending;
  act(() => {
    pending = result.current.ingestAtomic(files);
  });
  let outcome;
  pending.then((value) => {
    outcome = value;
  });
  await waitFor(() => expect(outcome).not.toBeUndefined());
  return outcome;
}

describe("actual patched native image hook", () => {
  it("retains identical PDF pages and releases all reservations", async () => {
    const useImages = hook(image);
    const { result } = renderHook(() => useImages([], { current: null }));
    expect(await ingest(result, [file("one.png"), file("two.png")])).toBe(true);
    expect(result.current.images.map((i) => i.name)).toEqual([
      "one.png",
      "two.png",
    ]);
    expect(result.current.pendingCountRef.current).toBe(0);
  });
  it("commits no pages when any image conversion fails", async () => {
    const useImages = hook(async (f) =>
      f.name === "bad.png" ? null : image(f),
    );
    const { result } = renderHook(() => useImages([], { current: null }));
    expect(await ingest(result, [file("one.png"), file("bad.png")])).toBe(
      false,
    );
    expect(result.current.images).toHaveLength(0);
    expect(result.current.pendingCountRef.current).toBe(0);
  });
  it("invalidating a draft aborts the batch without leaking reservations", async () => {
    let release;
    const useImages = hook(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useImages([], { current: null }));
    let pending;
    act(() => {
      pending = result.current.ingestAtomic([file("one.png")]);
    });
    await waitFor(() => expect(release).toBeTypeOf("function"));
    act(() => result.current.invalidate());
    await act(async () => {
      release(await image(file("one.png")));
      expect(await pending).toBe(false);
    });
    expect(result.current.images).toHaveLength(0);
    expect(result.current.pendingCountRef.current).toBe(0);
  });
  it("leaves ordinary image ingestion available", async () => {
    const useImages = hook(image);
    const { result } = renderHook(() => useImages([], { current: null }));
    act(() => result.current.ingest([file("ordinary.png")]));
    await waitFor(() => expect(result.current.images).toHaveLength(1));
    expect(result.current.images[0].name).toBe("ordinary.png");
  });
});
