export interface AppPreferences {
  defaultServings: number;
  taste: string;
  restrictions: string;
  equipment: string;
  startPage: "home" | "recipes" | "pantry" | "planner" | "shopping";
  sendShortcut: "enter" | "ctrlEnter";
  automaticBackup: boolean;
}

export const defaultPreferences: AppPreferences = {
  defaultServings: 2,
  taste: "",
  restrictions: "",
  equipment: "",
  startPage: "planner",
  sendShortcut: "enter",
  automaticBackup: true,
};

export function preferencesOf(value?: Partial<AppPreferences>): AppPreferences {
  return { ...defaultPreferences, ...value };
}
