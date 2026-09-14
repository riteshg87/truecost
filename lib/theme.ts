/**
 * Appearance.
 *
 * Three states, not two. "System" is the honest default — most people never
 * touch a theme control and expect an app to follow the phone — but someone who
 * reads at night on a light-mode laptop needs to be able to say so, and get it
 * remembered.
 *
 * The resolution is kept here as plain functions so the cycle and the applied
 * result can be tested without a browser.
 */

export type ThemeMode = "system" | "light" | "dark";
export type Resolved = "light" | "dark";

export const THEME_KEY = "truecost.theme";
export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

/** System → light → dark → system. */
export function nextMode(mode: ThemeMode): ThemeMode {
  const i = THEME_MODES.indexOf(mode);
  return THEME_MODES[(i + 1) % THEME_MODES.length];
}

/** What the user will actually see, given their OS preference. */
export function resolveMode(mode: ThemeMode, prefersDark: boolean): Resolved {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/**
 * The value for the root data-theme attribute.
 *
 * Null on "system", because the attribute has to be absent for the
 * prefers-color-scheme rule to govern — stamping a value there would freeze the
 * theme at whatever the OS said when the page loaded.
 */
export function attributeFor(mode: ThemeMode): string | null {
  return mode === "system" ? null : mode;
}

/** Browser chrome colour, matching the token the page paints with. */
export const THEME_COLOR: Record<Resolved, string> = {
  light: "#f7f7f4",
  dark: "#0d0f12",
};

export function labelFor(mode: ThemeMode): string {
  return mode === "system" ? "Match system" : mode === "light" ? "Light" : "Dark";
}

/**
 * Run before first paint, so the page never flashes the wrong theme.
 *
 * Inlined into the document head as a string — a React effect runs after the
 * browser has already painted, which is exactly the flash this avoids.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var m=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(m==="light"||m==="dark"){document.documentElement.setAttribute("data-theme",m);}
}catch(e){}})();`;
