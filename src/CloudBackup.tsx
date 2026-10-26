import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  LogOut,
  MailCheck,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { nativeMode } from "./services/kitchenClient";
import {
  cloudConfigured,
  cloudError,
  login,
  logout,
  refreshAccount,
  repository,
  resetPassword,
  snapshotBridge,
  verifyEmail,
  watchAccount,
} from "./services/cloudClient";
import type { CloudManifest, RestorePreview } from "./services/cloudRepository";
import "./cloud.css";
import SyncPanel from "./SyncPanel";

interface Account {
  uid: string;
  email: string | null;
  verified: boolean;
}
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export default function CloudBackup({
  onRestored,
  onBusyChange,
}: {
  onRestored: () => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(cloudConfigured && nativeMode);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const locked = busy || syncBusy;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  const [backups, setBackups] = useState<CloudManifest[]>([]);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const previewRef = useRef<HTMLElement>(null);
  const accountRef = useRef<string | null>(null);
  useEffect(() => {
    if (preview) previewRef.current?.scrollIntoView({ block: "nearest" });
  }, [preview]);
  useEffect(() => {
    if (!cloudConfigured || !nativeMode) return;
    return watchAccount(
      (user) => {
        if (!user) setRegister(false);
        setAccount(
          user
            ? { uid: user.uid, email: user.email, verified: user.emailVerified }
            : null,
        );
        if (accountRef.current !== user?.uid) {
          setBackups([]);
          setPreview(null);
          setPassword("");
          void invoke("kitchen_backup_cancel").catch(() => {});
        }
        accountRef.current = user?.uid ?? null;
        setLoading(false);
      },
      (e) => {
        setError(cloudError(e));
        setLoading(false);
      },
    );
  }, []);
  useEffect(
    () => () => {
      if (nativeMode) void invoke("kitchen_backup_cancel").catch(() => {});
    },
    [],
  );
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusyChange(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(cloudError(e));
    } finally {
      setBusy(false);
      onBusyChange(false);
      setProgress("");
    }
  }
  if (!nativeMode || !cloudConfigured)
    return (
      <section className="cloud-intro">
        <Cloud size={32} strokeWidth={1.3} />
        <h3>{nativeMode ? "云服务尚未连接" : "在桌面版使用云备份"}</h3>
        <p>
          {nativeMode
            ? "此版本还未配置 Chefish 独立云项目。连接后，可登录账户保存厨房备份，并在其他电脑上下载恢复。"
            : "浏览器演示使用独立数据。桌面版连接云服务后可使用账户与云备份。"}
        </p>
        <p className="settings-note">本机数据与本地备份仍可正常使用。</p>
      </section>
    );
  return (
    <div className="cloud-settings" aria-busy={busy || loading}>
      <div className="settings-group-label">
        {account ? "我的账户" : "连接你的厨房"}
      </div>
      <p className="settings-note">
        登录后可明确选择连接云端厨房或开启自动同步。登录和退出都会保留这台电脑的厨房数据。
      </p>
      {loading ? (
        <p role="status">正在读取账户…</p>
      ) : !account ? (
        <>
          <form
            className="cloud-login"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await login(email, password, register);
                setPassword("");
                setMessage(
                  register
                    ? "账户已创建，请前往邮箱完成验证。"
                    : "已登录，请刷新云备份列表。",
                );
              });
            }}
          >
            <label>
              邮箱
              <input
                type="email"
                autoComplete="email"
                required
                disabled={locked}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              密码
              <input
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={6}
                required
                disabled={locked}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="actions">
              <button className="primary" disabled={locked} type="submit">
                {register ? "创建账户" : "登录"}
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  setRegister(!register);
                  setPassword("");
                  setError("");
                }}
              >
                {register ? "已有账户，去登录" : "注册新账户"}
              </button>
              <button
                type="button"
                disabled={locked || !email.trim()}
                onClick={() =>
                  void run(async () => {
                    await resetPassword(email);
                    setMessage("如该邮箱已注册，将收到密码重置邮件。");
                  })
                }
              >
                忘记密码
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <div className="settings-row">
            <div>
              <strong>{account.email}</strong>
              <p>
                {account.verified ? "邮箱已验证" : "请先验证邮箱，再使用云备份"}
              </p>
            </div>
            <button
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  await logout();
                  setMessage("已退出，本机厨房数据已保留。");
                })
              }
            >
              <LogOut size={15} />
              退出登录
            </button>
          </div>
          {!account.verified ? (
            <div className="actions">
              <button
                disabled={locked}
                onClick={() =>
                  void run(async () => {
                    await verifyEmail();
                    setMessage("验证邮件已发送，请检查收件箱和垃圾邮件。");
                  })
                }
              >
                <MailCheck size={16} />
                重发验证邮件
              </button>
              <button
                disabled={locked}
                onClick={() =>
                  void run(async () => {
                    const user = await refreshAccount();
                    setAccount({
                      uid: user.uid,
                      email: user.email,
                      verified: user.emailVerified,
                    });
                    setMessage(
                      user.emailVerified
                        ? "邮箱已验证，可以使用云备份。"
                        : "邮箱尚未完成验证。",
                    );
                  })
                }
              >
                我已验证，刷新
              </button>
            </div>
          ) : (
            <>
              <SyncPanel
                disabled={busy || !!preview}
                onBusyChange={(value) => {
                  setSyncBusy(value);
                  onBusyChange(value);
                }}
              />
              <div className="settings-group-label">厨房云备份</div>
              <div className="settings-row">
                <div>
                  <strong>保存当前厨房</strong>
                  <p>包含菜谱与图片、库存、菜单、烹饪记录和用餐偏好。</p>
                </div>
                <button
                  className="primary"
                  disabled={locked || !!preview}
                  onClick={() =>
                    void run(async () => {
                      await repository().upload(snapshotBridge, setProgress);
                      setBackups(await repository().list());
                      setMessage("厨房备份已上传。");
                    })
                  }
                >
                  <CloudUpload size={16} />
                  上传备份
                </button>
              </div>
              <p className="settings-note">
                聊天记录、模型密钥及账户凭据不会上传。手动备份可独立保存某个时刻的厨房；恢复后需重新连接自动同步。
              </p>
              <div className="cloud-list-heading">
                <strong>云端备份</strong>
                <button
                  disabled={locked || !!preview}
                  onClick={() =>
                    void run(async () => {
                      setBackups(await repository().list());
                      setMessage("云端列表已刷新，显示最近 20 份。");
                    })
                  }
                >
                  刷新列表
                </button>
              </div>
              {backups.length ? (
                <ul className="cloud-backup-list">
                  {backups.map((backup) => (
                    <li key={backup.id}>
                      <div>
                        <strong>
                          {new Date(backup.createdAt * 1000).toLocaleString(
                            "zh-CN",
                          )}
                        </strong>
                        <small>{size(backup.sizeBytes)} · 含菜谱图片</small>
                      </div>
                      <button
                        disabled={locked || !!preview}
                        onClick={() =>
                          void run(async () => {
                            setPreview(
                              await repository().download(
                                backup,
                                snapshotBridge,
                                setProgress,
                              ),
                            );
                          })
                        }
                      >
                        <CloudDownload size={16} />
                        下载预览
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="settings-note">
                  点击刷新查看备份，或上传这台电脑的厨房。
                </p>
              )}
              {preview && (
                <section
                  ref={previewRef}
                  className="settings-restore-preview"
                  aria-label="云备份恢复预览"
                >
                  <strong>备份已通过完整性检查</strong>
                  <dl>
                    {[
                      [preview.recipes, "菜谱"],
                      [preview.inventoryLots, "库存批次"],
                      [preview.plannedMeals, "菜单安排"],
                      [preview.cookingSessions, "烹饪记录"],
                    ].map(([count, label]) => (
                      <div key={label}>
                        <dd>{count}</dd>
                        <dt>{label}</dt>
                      </div>
                    ))}
                  </dl>
                  <p>
                    恢复将替换当前厨房数据和用餐偏好。会先保存本机安全备份；本机聊天记录、通用设置及模型密钥会保留。
                  </p>
                  <div className="actions">
                    <button
                      className="primary"
                      disabled={locked}
                      onClick={() =>
                        void run(async () => {
                          if (
                            !window.confirm(
                              "用云备份替换当前厨房数据与用餐偏好？将先保存本机安全备份，聊天记录和通用设置会保留。",
                            )
                          )
                            return;
                          await invoke("kitchen_backup_restore", {
                            token: preview.token,
                          });
                          setPreview(null);
                          const loaded = await onRestored();
                          setMessage(
                            loaded
                              ? "厨房数据已恢复，恢复前的内容也已留存备份。"
                              : "数据已恢复，界面读取失败，请关闭设置后重试加载。",
                          );
                        })
                      }
                    >
                      确认恢复云备份
                    </button>
                    <button
                      disabled={locked}
                      onClick={() =>
                        void run(async () => {
                          await invoke("kitchen_backup_cancel");
                          setPreview(null);
                        })
                      }
                    >
                      取消恢复
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
      {(progress || message) && (
        <p role="status" className="settings-saved">
          {progress || message}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
