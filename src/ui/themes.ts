import type { ThemeName } from "../model/types";

export interface Theme {
  name: ThemeName;
  label: string;
  blurb: string;
  /** CSS custom properties applied to the app root. */
  css: Record<string, string>;
  /** 3D canopy palette. */
  scene: {
    bg: string;
    fog: string;
    trunk: string;
    grid: string;
    particle: string;
    bloom: string;
    vine: string;
    bloomIntensity: number;
  };
}

export const THEMES: Record<ThemeName, Theme> = {
  holo: {
    name: "holo",
    label: "Cyan holo",
    blurb: "BruNet command look — amber brackets, cyan light.",
    css: {
      "--bg0": "#04050a",
      "--bg1": "#06080e",
      "--panel": "rgba(7, 10, 18, .9)",
      "--panel-2": "rgba(3, 5, 10, .6)",
      "--line": "rgba(79, 227, 255, .16)",
      "--line-2": "rgba(79, 227, 255, .32)",
      "--accent": "#4fe3ff",
      "--accent-rgb": "79, 227, 255",
      "--primary": "#ffb020",
      "--primary-rgb": "255, 176, 32",
      "--glow": "rgba(255, 176, 32, .45)",
      "--text": "#e6f1f8",
      "--dim": "#8fa6b6",
      "--mute": "#5e7483",
      "--wash-a": "rgba(255, 150, 20, .09)",
      "--wash-b": "rgba(79, 227, 255, .07)",
      "--wash-c": "rgba(122, 58, 255, .06)",
    },
    scene: {
      bg: "#03050a",
      fog: "#03050a",
      trunk: "#4fe3ff",
      grid: "#4fe3ff",
      particle: "#9ff3ff",
      bloom: "#ffcf6a",
      vine: "#ffb020",
      bloomIntensity: 0.9,
    },
  },
  biolume: {
    name: "biolume",
    label: "Bioluminescent",
    blurb: "Deep-sea teal with magenta spores.",
    css: {
      "--bg0": "#02070a",
      "--bg1": "#031014",
      "--panel": "rgba(3, 14, 18, .9)",
      "--panel-2": "rgba(2, 10, 12, .6)",
      "--line": "rgba(56, 255, 200, .16)",
      "--line-2": "rgba(56, 255, 200, .32)",
      "--accent": "#38ffc8",
      "--accent-rgb": "56, 255, 200",
      "--primary": "#ff5fd2",
      "--primary-rgb": "255, 95, 210",
      "--glow": "rgba(255, 95, 210, .45)",
      "--text": "#e2fbf4",
      "--dim": "#86b3a8",
      "--mute": "#557a71",
      "--wash-a": "rgba(255, 95, 210, .07)",
      "--wash-b": "rgba(56, 255, 200, .08)",
      "--wash-c": "rgba(40, 120, 255, .07)",
    },
    scene: {
      bg: "#010608",
      fog: "#010608",
      trunk: "#38ffc8",
      grid: "#1fbf9a",
      particle: "#9dffe6",
      bloom: "#ff7be0",
      vine: "#ff5fd2",
      bloomIntensity: 1.0,
    },
  },
  aurora: {
    name: "aurora",
    label: "Aurora",
    blurb: "Polar violet and green, soft and dreamy.",
    css: {
      "--bg0": "#05040c",
      "--bg1": "#0a0816",
      "--panel": "rgba(12, 9, 24, .9)",
      "--panel-2": "rgba(8, 6, 16, .6)",
      "--line": "rgba(160, 130, 255, .18)",
      "--line-2": "rgba(160, 130, 255, .34)",
      "--accent": "#a98bff",
      "--accent-rgb": "169, 139, 255",
      "--primary": "#6dffb0",
      "--primary-rgb": "109, 255, 176",
      "--glow": "rgba(109, 255, 176, .4)",
      "--text": "#efeaff",
      "--dim": "#a59cc4",
      "--mute": "#6d6690",
      "--wash-a": "rgba(109, 255, 176, .07)",
      "--wash-b": "rgba(169, 139, 255, .09)",
      "--wash-c": "rgba(255, 110, 200, .06)",
    },
    scene: {
      bg: "#04030a",
      fog: "#04030a",
      trunk: "#a98bff",
      grid: "#7b62ff",
      particle: "#d7ccff",
      bloom: "#6dffb0",
      vine: "#ff8fd8",
      bloomIntensity: 0.95,
    },
  },
};

export const STATUS_COLORS = {
  seed: "#9fb4c2",
  growing: "var(--accent)",
  blooming: "var(--primary)",
  dormant: "#6f86ff",
  pruned: "#5e6670",
} as const;
