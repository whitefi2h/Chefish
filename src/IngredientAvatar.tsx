import type { Ingredient } from "./model";
export default function IngredientAvatar({
  ingredient,
  size = "small",
}: {
  ingredient: Pick<Ingredient, "name" | "image">;
  size?: "small" | "large";
}) {
  return (
    <span className={`ingredient-avatar ${size}`}>
      {ingredient.image?.data ? (
        <img src={ingredient.image.data} alt={ingredient.name} loading="lazy" />
      ) : (
        <span aria-hidden="true">{ingredient.name.slice(0, 1)}</span>
      )}
    </span>
  );
}
