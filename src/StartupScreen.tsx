import { RotateCcw } from "lucide-react";
import { useState } from "react";
import "./startup.css";

export default function StartupScreen({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => Promise<unknown>;
}) {
  const [retrying, setRetrying] = useState(false);
  const failed = Boolean(error) && !retrying;
  return (
    <main className={`startup-screen${failed ? " startup-error" : ""}`}>
      <div className="startup-brand" aria-label="Chefish">
        <img src="/brand.svg" alt="" />
        <span>Chefish</span>
      </div>
      <section className="startup-content" aria-labelledby="startup-title">
        <div className="startup-illustration" aria-hidden="true">
          <svg viewBox="0 0 180 160" fill="none">
            <ellipse
              className="startup-shadow"
              cx="90"
              cy="133"
              rx="51"
              ry="5"
            />
            <g className="startup-steam" strokeLinecap="round" strokeWidth="3">
              <path d="M69 65c-13-13 12-18 0-32" />
              <path d="M90 57c-13-13 12-18 0-32" />
              <path d="M111 65c-13-13 12-18 0-32" />
            </g>
            <path
              d="M35 84c3 29 23 45 55 45s52-16 55-45"
              fill="var(--sage-soft)"
              stroke="var(--sage-border)"
              strokeWidth="2"
            />
            <ellipse
              cx="90"
              cy="84"
              rx="55"
              ry="10"
              fill="var(--card)"
              stroke="var(--sage)"
              strokeWidth="2"
            />
            <path
              d="M51 85c12-5 30-6 44-4"
              stroke="var(--sage-border)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <ellipse
              cx="107"
              cy="83"
              rx="10"
              ry="3"
              fill="var(--primary)"
              opacity=".8"
              transform="rotate(-12 107 83)"
            />
            <path
              d="M72 115c6 2 12 3 18 3"
              stroke="var(--sage)"
              strokeWidth="2"
              strokeLinecap="round"
              opacity=".45"
            />
          </svg>
        </div>
        <h1 id="startup-title">
          {failed ? "厨房暂时没有打开" : "正在打开你的厨房"}
        </h1>
        {failed ? (
          <>
            <p className="startup-error-message" role="alert">
              {error}
            </p>
            <button
              onClick={async () => {
                setRetrying(true);
                try {
                  await onRetry();
                } finally {
                  setRetrying(false);
                }
              }}
            >
              <RotateCcw size={15} />
              重试加载
            </button>
          </>
        ) : (
          <p className="startup-status" role="status">
            <span aria-hidden="true" />
            正在读取本机数据
          </p>
        )}
      </section>
      <p className="startup-signature">好好吃饭，慢慢生活。</p>
    </main>
  );
}
