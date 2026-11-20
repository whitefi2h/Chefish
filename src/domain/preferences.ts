export interface AppPreferences {
  inventoryMode: "exact" | "rough";
  kitchenName: string;
  defaultServings: number;
  taste: string;
  restrictions: string;
  equipment: string;
  startPage: "home" | "recipes" | "pantry" | "planner" | "shopping";
  sendShortcut: "enter" | "ctrlEnter";
  automaticBackup: boolean;
  showBreakfast: boolean;
  showLunch: boolean;
  showDinner: boolean;
}

export const defaultPreferences: AppPreferences = {
  inventoryMode: "exact",
  kitchenName: "我的厨房",
  defaultServings: 2,
  taste: "",
  restrictions: "",
  equipment: "",
  startPage: "planner",
  sendShortcut: "enter",
  automaticBackup: true,
  showBreakfast: false,
  showLunch: true,
  showDinner: true,
};

export function preferencesOf(value?: Partial<AppPreferences>): AppPreferences {
  return {
    ...defaultPreferences,
    ...value,
    kitchenName: value?.kitchenName?.trim() || defaultPreferences.kitchenName,
  };
}
