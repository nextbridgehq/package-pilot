import { createLightTheme, createDarkTheme, BrandVariants } from "@fluentui/react-components";

// Define brand color ramp
const brandRamp: BrandVariants = {
  10: "#020305",
  20: "#0F1B2E",
  30: "#132D4A",
  40: "#153B61",
  50: "#174A79",
  60: "#185C92",
  70: "#1A6EAC",
  80: "#0F6CBD", // Primary brand color
  90: "#3A8FD2",
  100: "#5AA7DE",
  110: "#78BEE8",
  120: "#96D4F1",
  130: "#B4E9F8",
  140: "#D1F5FC",
  150: "#E8FBFE",
  160: "#F5FDFF",
};

const baseLight = createLightTheme(brandRamp);
const baseDark = createDarkTheme(brandRamp);

export const packlabLightTheme = {
  ...baseLight,
  // Typography
  fontFamilyBase: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  fontSizeBase300: "14px",
  fontWeightRegular: 400,
  fontWeightSemibold: 600,

  // Border radii
  borderRadiusSmall: "4px",
  borderRadiusMedium: "6px",
  borderRadiusLarge: "12px",
  borderRadiusXLarge: "16px",

  // Shadows
  shadow4: "0 2px 8px rgba(0, 0, 0, 0.06)",
  shadow8: "0 4px 12px rgba(0, 0, 0, 0.08)",
  shadow16: "0 8px 24px rgba(0, 0, 0, 0.10)",

  // Spacing
  spacingHorizontalS: "8px",
  spacingHorizontalM: "12px",
  spacingHorizontalL: "16px",

  // Stroke
  strokeWidthThin: "1px",
  colorNeutralStroke1: "#e8e8e8",
  colorNeutralStroke2: "#f0f0f0",
};

export const packlabDarkTheme = {
  ...baseDark,
  fontFamilyBase: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  borderRadiusSmall: "4px",
  borderRadiusMedium: "6px",
  borderRadiusLarge: "12px",
  borderRadiusXLarge: "16px",
  shadow4: "0 2px 8px rgba(0, 0, 0, 0.2)",
  shadow8: "0 4px 16px rgba(0, 0, 0, 0.25)",
  shadow16: "0 8px 24px rgba(0, 0, 0, 0.3)",
  colorNeutralStroke1: "#3a3a3a",
  colorNeutralStroke2: "#2e2e2e",
};
