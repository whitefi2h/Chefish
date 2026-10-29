import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useSyncExternalStore } from "react";
import { nativeMode } from "./kitchenClient";
import type { ShoppingForecast } from "../domain/shopping";

export interface StewardSettings {
  enabled: boolean;
  owner: string;
  doNotDisturb: boolean;
  autostart: boolean;
  weekly: boolean;
  weeklyNotify: boolean;
  weeklyDay: number;
  weeklyTime: string;
  maintenance: boolean;
  maintenanceNotify: boolean;
  maintenanceTime: string;
  recommendations: boolean;
  recommendationsNotify: boolean;
  recommendationsDay: number;
  recommendationsTime: string;
  recommendationInterval: number;
  meals: string[];
  allowEstimates: boolean;
}
export interface StewardMetadata {
  tags?: string[];
  reviewOn?: string | null;
  suggestedLocation?: string | null;
  origin?: string;
  basis?: string;
}
export interface StewardCandidate {
  id: string;
  title: string;
  url: string;
  author?: string;
  reason: string;
  verification: string;
}
export interface StewardItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  unread: boolean;
  createdAt: string;
  payload: {
    weekStart?: string;
    draftId?: string;
    operationId?: string | null;
    operations?: string[];
    task?: string;
    questions?: { entityKind: string; entityId: string; question: string }[];
    items?: {
      entityKind: string;
      entityId: string;
      name: string;
      metadata: StewardMetadata;
    }[];
    candidates?: StewardCandidate[];
  };
}
export interface StewardState {
  settings: StewardSettings;
  deviceId: string;
  items: StewardItem[];
  runs: { kind: string; status: string; error: string }[];
}
export interface StewardSlot {
  planId: string | null;
  recipeRevisionId: string | null;
  customTitle: string | null;
  day: string;
  meal: string;
  servings: number;
}
export interface StewardDraft {
  id: string;
  weekStart: string;
  messages: { role: string; content: string }[];
  slots: StewardSlot[];
  version: number;
  status: string;
}

let current: StewardState | null = null;
const subscribers = new Set<() => void>();
export async function refreshSteward() {
  if (!nativeMode) return;
  const next = await invoke<StewardState>("kitchen_steward_state");
  if (!next?.settings || !Array.isArray(next.items)) return;
  current = next;
  subscribers.forEach((fn) => fn());
}
export function useSteward() {
  const state = useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    () => current,
  );
  useEffect(() => {
    if (!current) void refreshSteward().catch(() => {});
  }, []);
  return state;
}
export async function startStewardEvents() {
  await refreshSteward();
  return listen("chefish:steward", () => {
    void refreshSteward().catch(() => {});
    window.dispatchEvent(new Event("chefish:sync-data"));
    window.dispatchEvent(new Event("chefish:sync-wake"));
  });
}
export const steward = {
  reviewDate: (id: string, date: string | null) =>
    invoke("kitchen_steward_review_date", { id, date }),
  tags: (kind: string, id: string, tags: string[]) =>
    invoke("kitchen_steward_tags", { kind, id, tags }),
  save: (settings: StewardSettings) =>
    invoke("kitchen_steward_settings", { settings }),
  mark: (id: string, status: string) =>
    invoke("kitchen_steward_mark", { id, status }),
  run: (kind: string) => invoke("kitchen_steward_run", { kind }),
  draft: (id?: string, weekStart?: string) =>
    invoke<StewardDraft>("kitchen_steward_draft", {
      id: id ?? null,
      weekStart: weekStart ?? null,
    }),
  reply: (draft: StewardDraft, message: string) =>
    invoke<StewardDraft>("kitchen_steward_reply", {
      id: draft.id,
      version: draft.version,
      message,
    }),
  preview: (id: string) =>
    invoke<{
      before: ShoppingForecast;
      after: ShoppingForecast;
      expectedRevision: string;
      changes: { section: string; before: string; after: string }[];
    }>("kitchen_steward_preview", { id }),
  confirm: (draft: StewardDraft, expectedRevision: string) =>
    invoke<ShoppingForecast>("kitchen_steward_confirm", {
      id: draft.id,
      version: draft.version,
      expectedRevision,
    }),
  rebase: (draft: StewardDraft) =>
    invoke<StewardDraft>("kitchen_steward_rebase", {
      id: draft.id,
      version: draft.version,
    }),
  undo: (operationId: string) =>
    invoke("kitchen_steward_undo", { operationId }),
  rule: (
    alias: string,
    canonical: string,
    fromUnit: string | null,
    toUnit: string | null,
    factor: string | null,
  ) =>
    invoke("kitchen_steward_rule", {
      rule: { alias, canonical, fromUnit, toUnit, factor },
    }),
};
