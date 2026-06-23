// Tests for the realtime transport helpers (DEV-1192).
// The live delivery needs a Supabase project; here we pin the pure contract:
// topic/event shape, safe no-op when unconfigured, and the publish HTTP call when
// configured.

import { afterEach, describe, expect, it, vi } from "vitest";

import { DIAGRAM_CHANGED_EVENT, diagramTopic, isRealtimeConfigured } from "./config";

describe("realtime config", () => {
  it("derives one channel topic per diagram", () => {
    expect(diagramTopic("abc")).toBe("diagram:abc");
    expect(DIAGRAM_CHANGED_EVENT).toBe("changed");
  });

  it("is unconfigured without the Supabase env (falls back to polling)", () => {
    // No NEXT_PUBLIC_SUPABASE_* set in the test env.
    expect(isRealtimeConfigured()).toBe(false);
  });
});

describe("publishDiagramChange", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("is a no-op (no fetch) when realtime isn't configured", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const { publishDiagramChange } = await import("./publish");
    await publishDiagramChange("d1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs a content-free broadcast to the diagram topic when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.resetModules();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const { publishDiagramChange } = await import("./publish");

    await publishDiagramChange("d1");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/realtime/v1/api/broadcast");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0]).toMatchObject({
      topic: "diagram:d1",
      event: "changed",
      payload: {},
    });
  });

  it("never throws when the transport fails (best-effort)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.resetModules();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { publishDiagramChange } = await import("./publish");
    await expect(publishDiagramChange("d1")).resolves.toBeUndefined();
  });
});
