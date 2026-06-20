/**
 * Open-redirect guard for the post-login `next` param (DEV-1134 / DEV-1147 seam).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_LOGIN_PATH,
  isSafeNextPath,
  safeNextPath,
} from "./safe-next";

describe("isSafeNextPath", () => {
  it("accepts same-origin relative paths", () => {
    expect(isSafeNextPath("/dashboard")).toBe(true);
    expect(isSafeNextPath("/api/mcp/oauth/authorize?client_id=abc&state=xyz")).toBe(
      true,
    );
    expect(isSafeNextPath("/a/b/c")).toBe(true);
  });

  it("rejects absent or empty values", () => {
    expect(isSafeNextPath(undefined)).toBe(false);
    expect(isSafeNextPath(null)).toBe(false);
    expect(isSafeNextPath("")).toBe(false);
  });

  it("rejects paths that are not origin-relative", () => {
    expect(isSafeNextPath("dashboard")).toBe(false);
    expect(isSafeNextPath("https://evil.example/")).toBe(false);
    expect(isSafeNextPath("javascript:alert(1)")).toBe(false);
  });

  it("rejects protocol-relative and backslash-escape open redirects", () => {
    expect(isSafeNextPath("//evil.example")).toBe(false);
    expect(isSafeNextPath("/\\evil.example")).toBe(false);
    expect(isSafeNextPath("/path\\to")).toBe(false);
    expect(isSafeNextPath("\\\\evil.example")).toBe(false);
  });

  it("rejects whitespace/control-character smuggling", () => {
    expect(isSafeNextPath("/foo\n//evil.example")).toBe(false);
    expect(isSafeNextPath("/ /evil")).toBe(false);
    expect(isSafeNextPath("/\thttps://evil")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("passes through a safe path unchanged", () => {
    expect(safeNextPath("/api/mcp/oauth/authorize?x=1")).toBe(
      "/api/mcp/oauth/authorize?x=1",
    );
  });

  it("falls back to the default for unsafe or missing input", () => {
    expect(safeNextPath(undefined)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeNextPath("//evil.example")).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeNextPath("https://evil.example")).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it("honors a caller-supplied fallback", () => {
    expect(safeNextPath(null, "/home")).toBe("/home");
  });
});
