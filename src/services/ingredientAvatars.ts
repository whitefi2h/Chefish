import data from "../generated/ingredientAvatars.json";
import type { IngredientImage } from "../model";

const photoKey = "chefish:explicit-ingredient-photos:v1";
let chosenPhotos: Record<string, boolean> = {};
try {
  chosenPhotos = JSON.parse(localStorage.getItem(photoKey) ?? "{}");
} catch {
  /* Session choices still work. */
}
const photoName = (name: string) => name.normalize("NFKC").trim().toLowerCase();

export function rememberIngredientPhoto(name: string) {
  chosenPhotos[photoName(name)] = true;
  try {
    localStorage.setItem(photoKey, JSON.stringify(chosenPhotos));
  } catch {
    /* Retain this session's explicit choice. */
  }
}

export function usesIngredientPhoto(ingredient: {
  name: string;
  image?: IngredientImage;
}) {
  if (!ingredient.image?.data) return false;
  // Legacy Commons images include automatically fetched photos and have no user-choice provenance.
  // Keep the data, but use the new visual style unless the user explicitly chooses a photo.
  return (
    !!chosenPhotos[photoName(ingredient.name)] ||
    !ingredient.image.sourceUrl.startsWith("https://commons.wikimedia.org/")
  );
}

type Asset = {
  url: string;
  author: string;
  license: string;
  sourceUrl: string;
  licenseUrl: string;
};
const assets: Record<string, Asset> = data.assets;
const entries: {
  id: string;
  names: string[];
  label: string;
  category: string;
  kind: string;
  preferred: string | null;
  candidates: string[];
}[] = data.entries;
const tones: Record<string, { background: string; color: string }> = data.tones;
const key = "chefish:ingredient-avatar-selections:v1";
let assignments: Record<string, string> = {};
try {
  assignments = JSON.parse(localStorage.getItem(key) ?? "{}");
} catch {
  /* A session can still use offline avatars. */
}

export function ingredientAvatar(name: string, identity?: string) {
  const normalized = name
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ");
  const entry = data.ambiguousNames.includes(normalized)
    ? undefined
    : entries.find((e) => e.names.includes(normalized));
  const text = {
    label: Array.from(name.trim())[0] ?? "食",
    ...(tones[entry?.category ?? ""] ?? data.defaultTone),
  };
  if (!entry?.candidates.length) return { text, asset: undefined };
  const id = identity ?? entry.id;
  let selected = assignments[id];
  if (!entry.candidates.includes(selected)) {
    selected =
      entry.kind === "category"
        ? entry.candidates[Math.floor(Math.random() * entry.candidates.length)]
        : (entry.preferred ?? entry.candidates[0]);
    assignments[id] = selected;
    try {
      localStorage.setItem(key, JSON.stringify(assignments));
    } catch {
      /* Keep the choice stable for this session. */
    }
  }
  return { text, asset: assets[selected] };
}
