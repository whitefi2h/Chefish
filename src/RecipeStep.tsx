import { useState } from "react";
export default function RecipeStep({
  number,
  title,
  body,
  image,
  onOpen,
}: {
  number: number;
  title?: string;
  body: string;
  image?: string;
  onOpen: (image: string, number: number) => void;
}) {
  const [portrait, setPortrait] = useState(false);
  return (
    <section
      className={`recipe-step ${image ? "with-photo" : ""} ${portrait ? "portrait" : "landscape"}`}
      aria-label={`步骤 ${number}`}
    >
      <span className="step-number">{number}</span>
      <div className="step-body">
        <div className="step-copy">
          {title && <h3>{title}</h3>}
          <p>{body}</p>
        </div>
        {image && (
          <button
            className="step-photo-button"
            aria-label={`放大步骤${number}图片`}
            onClick={() => onOpen(image, number)}
          >
            <img
              src={image}
              alt={`原步骤 ${number}`}
              loading="lazy"
              onLoad={(e) =>
                setPortrait(
                  e.currentTarget.naturalHeight > e.currentTarget.naturalWidth,
                )
              }
            />
          </button>
        )}
      </div>
    </section>
  );
}
