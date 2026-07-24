import { makeStyles, tokens, shorthands } from "@fluentui/react-components";

export const useSharedStyles = makeStyles({
  card: {
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    boxShadow: tokens.shadow4,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    transition: "box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease",
  },

  cardInteractive: {
    cursor: "pointer",
    ":hover": {
      boxShadow: tokens.shadow8,
      ...shorthands.borderColor(tokens.colorBrandStroke1),
      transform: "translateY(-2px)",
    },
    ":active": {
      transform: "translateY(0)",
      boxShadow: tokens.shadow4,
    },
  },

  cardAccentTop: {
    borderTopWidth: "3px",
    borderTopStyle: "solid",
  },
  cardAccentSuccess: {
    borderTopColor: tokens.colorPaletteGreenBorder1,
  },
  cardAccentWarning: {
    borderTopColor: tokens.colorPaletteYellowBorder1,
  },
  cardAccentDanger: {
    borderTopColor: tokens.colorPaletteRedBorder1,
  },

  buttonPrimary: {
    fontWeight: tokens.fontWeightSemibold,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    transition: "transform 0.1s ease, box-shadow 0.2s ease",
    ":active": {
      transform: "scale(0.97)",
    },
  },

  uniformButton: {
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke1),
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    transition: "transform 0.1s ease",
    ":active": {
      transform: "scale(0.97)",
    },
  },
});
