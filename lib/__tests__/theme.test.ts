import { describe, expect, it } from "vitest";
import {
  THEME_INIT_SCRIPT,
  THEME_MODES,
  attributeFor,
  isThemeMode,
  nextMode,
  resolveMode,
  type ThemeMode,
} from "../theme";

describe("theme mode", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextMode("system")).toBe("light");
    expect(nextMode("light")).toBe("dark");
    expect(nextMode("dark")).toBe("system");
  });

  it("returns to where it started after a full cycle", () => {
    let m: ThemeMode = "system";
    for (let i = 0; i < THEME_MODES.length; i++) m = nextMode(m);
    expect(m).toBe("system");
  });

  it("resolves system against the OS, and an explicit choice against nothing", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
    expect(resolveMode("light", true)).toBe("light");
  });

  it("leaves the attribute off for system, so the media query can govern", () => {
    // Stamping a value here would freeze the theme at whatever the OS said
    // when the page loaded, which is the bug this guards.
    expect(attributeFor("system")).toBeNull();
    expect(attributeFor("light")).toBe("light");
    expect(attributeFor("dark")).toBe("dark");
  });

  it("only accepts the three known modes", () => {
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("auto")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });

  it("ships an init script that cannot throw on blocked storage", () => {
    expect(THEME_INIT_SCRIPT).toContain("try");
    expect(THEME_INIT_SCRIPT).toContain("catch");
    // It must never write "system" onto the element.
    expect(THEME_INIT_SCRIPT).not.toContain('"system"');
  });
});
