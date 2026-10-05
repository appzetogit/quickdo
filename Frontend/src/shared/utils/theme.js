export const FOOD_USER_THEME_KEY = "foodUserTheme";

export function applyTheme(theme) {
  if (typeof document === "undefined") return;

  const useDarkTheme = theme === "dark";
  const targets = [
    document.documentElement,
    document.body,
    document.getElementById("root"),
  ];

  targets.forEach((target) => {
    target?.classList.toggle("dark", useDarkTheme);
  });
}

export function getFoodUserTheme() {
  if (typeof localStorage === "undefined") return "light";
  return localStorage.getItem(FOOD_USER_THEME_KEY) === "dark" ? "dark" : "light";
}

export function applyFoodUserTheme() {
  const theme = getFoodUserTheme();
  applyTheme(theme);
  return theme;
}

export function saveFoodUserTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(FOOD_USER_THEME_KEY, normalizedTheme);
  }
  applyTheme(normalizedTheme);
  return normalizedTheme;
}

export function applySavedTheme() {
  const savedTheme =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("appTheme") || "light"
      : "light";

  applyTheme(savedTheme);
  return savedTheme;
}
