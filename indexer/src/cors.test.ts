import { describe, it, expect } from "vitest";
import { resolveAllowedOrigin } from "./cors.js";

describe("resolveAllowedOrigin", () => {
  it("returns '*' when no allowlist is configured (back-compat)", () => {
    expect(resolveAllowedOrigin("https://app.example", undefined)).toBe("*");
    expect(resolveAllowedOrigin("https://app.example", "")).toBe("*");
    expect(resolveAllowedOrigin("https://app.example", "  ")).toBe("*");
  });

  it("returns '*' when the allowlist explicitly contains '*'", () => {
    expect(resolveAllowedOrigin("https://app.example", "*")).toBe("*");
  });

  it("reflects the request origin when it is in the allowlist", () => {
    expect(
      resolveAllowedOrigin("https://app.example", "https://app.example, https://admin.example")
    ).toBe("https://app.example");
  });

  it("returns null when the request origin is not in the allowlist", () => {
    expect(
      resolveAllowedOrigin("https://evil.example", "https://app.example")
    ).toBe(null);
  });

  it("returns null when there is an allowlist but no request origin", () => {
    expect(resolveAllowedOrigin(undefined, "https://app.example")).toBe(null);
  });
});
