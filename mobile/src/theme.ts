// Mirrors the current Web workbench, not the older Harbor landing-page theme.
// Source: frontend/src/index.css (.flowlab-app-shell and role variants).
export const colors = {
  paper: "#FFFAF1",
  card: "#FFFFFF",
  ink: "#44434B",
  muted: "#777582",
  line: "#E7E5DC",
  inset: "#F5F3EE",
  green: "#638F56",
  greenDark: "#42663B",
  greenLight: "#EAF1DF",
  blue: "#33466D",
  blueLight: "#E9EDF7",
  pink: "#D95788",
  pinkLight: "#FBEAF0",
  gold: "#B68936",
  goldLight: "#F8EED5",
  lavender: "#727CAF",
  lavenderLight: "#EEEFFC",
  danger: "#C95362",
};
export type Tone = "green" | "blue" | "pink" | "gold" | "lavender";
export const toneColors = (tone: Tone) => ({
  main: colors[tone],
  soft: colors[(tone + "Light") as keyof typeof colors],
});
export const radius = { small: 12, medium: 18, large: 26, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 36 };

export const artwork = {
  mentor: require("../assets/brand/flowlab-review-mentor-writing.png"),
  interviewer: require("../assets/brand/flowlab-interview-coach-writing.png"),
  tailor: require("../assets/brand/flowlab-resume-tailor-working.png"),
  detective: require("../assets/brand/flowlab-job-detective-monocle-v2.png"),
  avatar: require("../assets/brand/flowlab-community-egg-avatar.png"),
  icon: require("../assets/brand/flowlab-shell-app-icon-192.png"),
  wordmark: require("../assets/brand/flowlab-wordmark-icon-o-v1.png"),
};
