import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { proxy } from "./proxy";

function request(path: string, withSession: boolean): NextRequest {
  const req = new NextRequest(new URL(`https://app.test${path}`));
  if (withSession) {
    req.cookies.set(SESSION_COOKIE_NAME, "any-token");
  }
  return req;
}

describe("protected-route proxy", () => {
  it("redirects unauthenticated requests for protected paths to /login", () => {
    const res = proxy(request("/dashboard", false));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fdashboard");
  });

  it("allows authenticated requests for protected paths", () => {
    const res = proxy(request("/dashboard", true));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not gate public paths", () => {
    const res = proxy(request("/login", false));
    expect(res.headers.get("location")).toBeNull();
  });

  it("gates nested protected paths", () => {
    const res = proxy(request("/dashboard/diagrams/123", false));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
  });
});
