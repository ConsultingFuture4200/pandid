/**
 * Tests for the MCP wire-protocol primitives (DEV-1145).
 *
 * Lock the JSON-RPC envelope parsing and the response builders — the framing
 * the route handler relies on. Zod-at-all-boundaries (CLAUDE.md): a malformed
 * inbound message must be rejected by the schema, not acted on.
 */
import { describe, expect, it } from "vitest";
import {
  JSONRPC_VERSION,
  MCP_PROTOCOL_VERSION,
  jsonRpcError,
  jsonRpcRequestSchema,
  jsonRpcSuccess,
} from "./protocol";

describe("jsonRpcRequestSchema", () => {
  it("accepts a well-formed request with object params", () => {
    const parsed = jsonRpcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "add_equipment" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a notification (no id)", () => {
    const parsed = jsonRpcRequestSchema.safeParse({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.id).toBeUndefined();
  });

  it("accepts a string id and a null id", () => {
    expect(
      jsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", id: "abc", method: "ping" }).success,
    ).toBe(true);
    expect(
      jsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", id: null, method: "ping" }).success,
    ).toBe(true);
  });

  it("rejects a wrong jsonrpc version", () => {
    expect(
      jsonRpcRequestSchema.safeParse({ jsonrpc: "1.0", id: 1, method: "ping" }).success,
    ).toBe(false);
  });

  it("rejects a missing or empty method", () => {
    expect(jsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", id: 1 }).success).toBe(false);
    expect(
      jsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", id: 1, method: "" }).success,
    ).toBe(false);
  });

  it("rejects a non-object, non-array params", () => {
    expect(
      jsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", id: 1, method: "x", params: 5 }).success,
    ).toBe(false);
  });
});

describe("response builders", () => {
  it("jsonRpcSuccess wraps a result with the id and version", () => {
    expect(jsonRpcSuccess(7, { ok: true })).toEqual({
      jsonrpc: JSONRPC_VERSION,
      id: 7,
      result: { ok: true },
    });
  });

  it("jsonRpcError omits data when not provided", () => {
    expect(jsonRpcError(7, -32601, "nope")).toEqual({
      jsonrpc: JSONRPC_VERSION,
      id: 7,
      error: { code: -32601, message: "nope" },
    });
  });

  it("jsonRpcError includes data when provided", () => {
    const res = jsonRpcError(null, -32602, "bad", { field: "name" });
    expect(res.error.data).toEqual({ field: "name" });
    expect(res.id).toBeNull();
  });
});

describe("protocol constants", () => {
  it("pins the Streamable HTTP protocol revision and JSON-RPC version", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2025-11-25");
    expect(JSONRPC_VERSION).toBe("2.0");
  });
});
