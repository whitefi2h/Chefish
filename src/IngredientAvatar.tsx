import type { Ingredient } from "./model";
import { useState } from "react";
import {
  ingredientAvatar,
  usesIngredientPhoto,
} from "./services/ingredientAvatars";
import data from "./generated/ingredientAvatars.json";
import { invoke } from "@tauri-apps/api/core";
import { nativeMode, errorMessage } from "./services/kitchenClient";

function SourceLink({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (nativeMode) {
            e.preventDefault();
            void invoke("kitchen_open_image_source", { url }).catch((err) =>
              setError(errorMessage(err)),
            );
          }
        }}
      >
        {children}
      </a>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

export function IngredientIconLicenses() {
  return (
    <details className="ingredient-icon-licenses">
      <summary>食材图标来源与许可</summary>
      <p>图形保留原始颜色与路径／像素，未作修改。</p>
      {data.credits.map((c) => (
        <p key={c.name}>
          {c.name} · {c.author}
          {" · "}
          <SourceLink url={c.url}>{c.license}</SourceLink>
        </p>
      ))}
    </details>
  );
}
export default function IngredientAvatar({
  ingredient,
  size = "small",
}: {
  ingredient: Pick<Ingredient, "name" | "image"> & { id?: string };
  size?: "small" | "large";
}) {
  const avatar = ingredientAvatar(ingredient.name, ingredient.id);
  const sources = [
    usesIngredientPhoto(ingredient) ? ingredient.image?.data : undefined,
    avatar.asset?.url,
  ].filter((url): url is string => !!url);
  const [failed, setFailed] = useState<string[]>([]);
  const source = sources.find((url) => !failed.includes(url));
  return (
    <span
      className={`ingredient-avatar ${size} ${source ? "" : "text-avatar"}`}
      style={
        source
          ? undefined
          : { background: avatar.text.background, color: avatar.text.color }
      }
      title={
        source && source === avatar.asset?.url
          ? `${avatar.asset.author} · ${avatar.asset.license}`
          : ingredient.name
      }
    >
      {source ? (
        <img
          src={source}
          alt={ingredient.name}
          loading="lazy"
          onError={() => setFailed((previous) => [...previous, source])}
        />
      ) : (
        <span role="img" aria-label={`${ingredient.name}文字头像`}>
          {avatar.text.label}
        </span>
      )}
    </span>
  );
}

export function IngredientAvatarCredit({
  ingredient,
}: {
  ingredient: Pick<Ingredient, "name" | "image"> & { id?: string };
}) {
  const asset = ingredientAvatar(ingredient.name, ingredient.id).asset;
  if (usesIngredientPhoto(ingredient) || !asset) return null;
  return (
    <p className="ingredient-image-credit">
      图标：{asset.author} · {asset.license} · 原图未修改
      {" · "}
      <SourceLink url={asset.sourceUrl}>素材来源</SourceLink>
      {" · "}
      <SourceLink url={asset.licenseUrl}>许可说明</SourceLink>
    </p>
  );
}
