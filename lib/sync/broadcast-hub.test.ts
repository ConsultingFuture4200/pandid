// Broadcast-hub tests (DEV-1151 [12a], PRD §4).
//
// The server-side half: on commit the server fans the canonical scene out to
// every session on that diagram, isolates diagrams from each other, survives a
// dead sink, and tolerates (un)subscribe during delivery.

import { describe, expect, it, vi } from "vitest";
import { BroadcastHub, getBroadcastHub } from "./broadcast-hub";
import type { SceneBroadcast } from "./types";

const DIAGRAM_A = "11111111-1111-4111-8111-111111111111";
const DIAGRAM_B = "99999999-9999-4999-8999-999999999999";
const V1 = "22222222-2222-4222-8222-222222222222";

function frame(diagramId: string, versionId = V1): SceneBroadcast {
  return { type: "scene", diagramId, versionId, scene: { v: versionId } };
}

describe("BroadcastHub", () => {
  it("delivers a published scene to every subscriber on its diagram", () => {
    const hub = new BroadcastHub();
    const a = vi.fn();
    const b = vi.fn();
    hub.subscribe(DIAGRAM_A, a);
    hub.subscribe(DIAGRAM_A, b);

    const delivered = hub.publish(frame(DIAGRAM_A));

    expect(delivered).toBe(2);
    expect(a).toHaveBeenCalledWith(frame(DIAGRAM_A));
    expect(b).toHaveBeenCalledWith(frame(DIAGRAM_A));
  });

  it("isolates diagrams: a publish to A never reaches a B subscriber", () => {
    const hub = new BroadcastHub();
    const onA = vi.fn();
    const onB = vi.fn();
    hub.subscribe(DIAGRAM_A, onA);
    hub.subscribe(DIAGRAM_B, onB);

    hub.publish(frame(DIAGRAM_A));

    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
  });

  it("returns 0 when nobody is viewing the diagram (a normal case)", () => {
    const hub = new BroadcastHub();
    expect(hub.publish(frame(DIAGRAM_A))).toBe(0);
  });

  it("stops delivering to an unsubscribed sink", () => {
    const hub = new BroadcastHub();
    const sink = vi.fn();
    const off = hub.subscribe(DIAGRAM_A, sink);
    off();

    expect(hub.publish(frame(DIAGRAM_A))).toBe(0);
    expect(sink).not.toHaveBeenCalled();
    expect(hub.subscriberCount(DIAGRAM_A)).toBe(0);
  });

  it("unsubscribe is idempotent", () => {
    const hub = new BroadcastHub();
    const off = hub.subscribe(DIAGRAM_A, vi.fn());
    off();
    expect(() => off()).not.toThrow();
    expect(hub.subscriberCount(DIAGRAM_A)).toBe(0);
  });

  it("isolates a throwing sink: the rest still receive the frame", () => {
    const hub = new BroadcastHub();
    const bad = vi.fn(() => {
      throw new Error("dead socket");
    });
    const good = vi.fn();
    hub.subscribe(DIAGRAM_A, bad);
    hub.subscribe(DIAGRAM_A, good);

    const delivered = hub.publish(frame(DIAGRAM_A));

    expect(good).toHaveBeenCalledTimes(1);
    expect(delivered).toBe(1); // only the good sink counts
    // The throwing sink was dropped.
    expect(hub.subscriberCount(DIAGRAM_A)).toBe(1);
  });

  it("a sink that unsubscribes during delivery does not perturb the in-flight fan-out", () => {
    const hub = new BroadcastHub();
    const order: string[] = [];
    const off = hub.subscribe(DIAGRAM_A, () => {
      order.push("first");
      off(); // mutate the set mid-delivery
    });
    hub.subscribe(DIAGRAM_A, () => order.push("second"));

    const delivered = hub.publish(frame(DIAGRAM_A));

    // Both sinks present at publish time still received the frame.
    expect(order).toEqual(["first", "second"]);
    expect(delivered).toBe(2);
    // The first one is gone for the next publish.
    expect(hub.subscriberCount(DIAGRAM_A)).toBe(1);
  });

  it("rejects a malformed broadcast at the boundary (Zod)", () => {
    const hub = new BroadcastHub();
    hub.subscribe(DIAGRAM_A, vi.fn());
    const bad = { type: "scene", diagramId: "not-a-uuid", versionId: V1, scene: {} };
    expect(() => hub.publish(bad as unknown as SceneBroadcast)).toThrow();
  });

  it("getBroadcastHub returns a stable process-wide instance", () => {
    expect(getBroadcastHub()).toBe(getBroadcastHub());
  });
});
