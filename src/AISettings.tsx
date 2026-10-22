import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  aiStatus,
  type AIStatus,
  type Provider,
  type AISettings as Settings,
} from "./services/aiClient";
import { errorMessage } from "./services/kitchenClient";

export default function AISettings({
  onSaved,
}: {
  onSaved?: (status: AIStatus) => void;
}) {
  const [settings, setSettings] = useState<Settings>({
    provider: "deepseek",
    model: "deepseek-flash",
    timeout: 90,
    maxTokens: 8192,
  });
  const [configured, setConfigured] = useState<Provider[]>([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    aiStatus()
      .then((s) => {
        if (alive) {
          setSettings(s.settings);
          setConfigured(s.configured);
          setReady(true);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  async function save(remove = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const s = await invoke<AIStatus>("kitchen_ai_save_settings", {
        settings,
        key: key || null,
        remove,
      });
      setKey("");
      setConfigured(s.configured);
      setMessage(remove ? "密钥已移除" : "配置已保存");
      onSaved?.(s);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-stack ai-settings">
      <h3>模型设置</h3>
      <label>
        模型服务
        <select
          value={settings.provider}
          disabled={busy || !ready}
          onChange={(e) => {
            const provider = e.target.value as Provider;
            setSettings({
              ...settings,
              provider,
              model: provider === "deepseek" ? "deepseek-flash" : "",
            });
            setKey("");
            setMessage("");
          }}
        >
          <option value="deepseek">DeepSeek</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
        </select>
      </label>
      <label>
        模型名称
        <input
          value={settings.model}
          maxLength={100}
          placeholder="填写服务支持的模型 ID"
          disabled={busy || !ready}
          onChange={(e) => setSettings({ ...settings, model: e.target.value })}
        />
      </label>
      <label>
        API 密钥
        <input
          type="password"
          autoComplete="off"
          value={key}
          maxLength={500}
          disabled={busy || !ready}
          placeholder={
            configured.includes(settings.provider)
              ? "已保存；留空保留原密钥"
              : "仅存入 Windows 凭据管理器"
          }
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <div className="form-row">
        <label>
          超时（秒）
          <input
            type="number"
            min={10}
            max={180}
            value={settings.timeout}
            disabled={busy || !ready}
            onChange={(e) =>
              setSettings({ ...settings, timeout: Number(e.target.value) })
            }
          />
        </label>
        <label>
          输出 Token 上限
          <input
            type="number"
            min={512}
            max={16384}
            value={settings.maxTokens}
            disabled={busy || !ready}
            onChange={(e) =>
              setSettings({ ...settings, maxTokens: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <p className="hint">
        调用按服务计费。只发送当前对话、候选摘要和你选择整理的菜谱，不发送库存及手记。联网检索使用
        DeepSeek 密钥；切换模型服务后，该密钥仍保留。
      </p>
      <div className="actions">
        <button
          className="primary"
          disabled={busy || !ready || !settings.model.trim()}
          onClick={() => save()}
        >
          保存配置
        </button>
        <button
          disabled={busy || !ready || !configured.includes(settings.provider)}
          onClick={async () => {
            setBusy(true);
            setError("");
            setMessage("");
            try {
              await invoke("kitchen_ai_test");
              setMessage("连接正常");
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          测试已保存配置
        </button>
        {configured.includes(settings.provider) && (
          <button disabled={busy} onClick={() => save(true)}>
            移除密钥
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="hint">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!ready && (
        <button disabled={busy} onClick={() => setAttempt(attempt + 1)}>
          重试读取设置
        </button>
      )}
    </section>
  );
}
