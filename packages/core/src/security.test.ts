import { describe, it, expect } from "vitest";
import { RateLimiter, safeEqual } from "./security.js";

// ---------------------------------------------------------------------------
// safeEqual — constant-time-ish string comparison (for API keys)
// ---------------------------------------------------------------------------

describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("s3cret-key", "s3cret-key")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(safeEqual("aaaaaa", "aaaaab")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(safeEqual("short", "longer-value")).toBe(false);
  });

  it("returns false when either side is empty", () => {
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("x", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RateLimiter — fixed-window per-key limiter
// ---------------------------------------------------------------------------

describe("RateLimiter", () => {
  it("allows up to `limit` requests within the window", () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.check("a", 0)).toBe(true);
    expect(rl.check("a", 100)).toBe(true);
    expect(rl.check("a", 200)).toBe(true);
  });

  it("blocks the request that exceeds `limit` within the window", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.check("a", 0)).toBe(true);
    expect(rl.check("a", 100)).toBe(true);
    expect(rl.check("a", 200)).toBe(false);
  });

  it("resets after the window elapses", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check("a", 0)).toBe(true);
    expect(rl.check("a", 500)).toBe(false); // still in window
    expect(rl.check("a", 1000)).toBe(true); // window elapsed
  });

  it("tracks keys independently", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check("a", 0)).toBe(true);
    expect(rl.check("b", 0)).toBe(true); // different key, own budget
    expect(rl.check("a", 0)).toBe(false);
  });
});
