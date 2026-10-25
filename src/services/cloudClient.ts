import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { invoke } from "@tauri-apps/api/core";
import { CloudRepository, type SnapshotBridge } from "./cloudRepository";

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
export const cloudConfigured = Object.values(config).every(
  (value) => typeof value === "string" && value.trim(),
);
let services: ReturnType<typeof initialize> | undefined;
function initialize() {
  if (!cloudConfigured) throw new Error("此版本尚未连接 Chefish 云服务。");
  const app = initializeApp(config, "chefish");
  const auth = getAuth(app);
  const ready = setPersistence(auth, browserLocalPersistence);
  const db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
  });
  return { auth, db, ready };
}
function getServices() {
  return (services ??= initialize());
}
export function watchAccount(
  listener: (user: User | null) => void,
  error: (error: unknown) => void,
) {
  const { auth, ready } = getServices();
  let active = true;
  let stop = () => {};
  void ready
    .then(() => {
      if (active) stop = onAuthStateChanged(auth, listener, error);
    })
    .catch((e) => {
      if (active) error(e);
    });
  return () => {
    active = false;
    stop();
  };
}
export async function login(
  email: string,
  password: string,
  register: boolean,
) {
  const { auth, ready } = getServices();
  await ready;
  const credential = await (register
    ? createUserWithEmailAndPassword(auth, email.trim(), password)
    : signInWithEmailAndPassword(auth, email.trim(), password));
  if (register) await sendEmailVerification(credential.user);
}
export async function logout() {
  await signOut(getServices().auth);
}
export async function resetPassword(email: string) {
  await sendPasswordResetEmail(getServices().auth, email.trim());
}
export async function verifyEmail() {
  const user = getServices().auth.currentUser;
  if (user) await sendEmailVerification(user);
}
export async function refreshAccount() {
  const user = getServices().auth.currentUser;
  if (!user) throw new Error("请先登录。");
  await user.reload();
  await user.getIdToken(true);
  return user;
}
export function repository() {
  const { auth, db } = getServices();
  const user = auth.currentUser;
  if (!user?.emailVerified) throw new Error("请先登录并验证邮箱。");
  const uid = user.uid;
  return new CloudRepository(db, uid, () => {
    if (auth.currentUser?.uid !== uid || !auth.currentUser.emailVerified)
      throw new Error("账户已变化，请重新打开云备份。");
  });
}
export const snapshotBridge: SnapshotBridge = {
  prepare: () => invoke("cloud_backup_prepare"),
  read: (token, index) => invoke("cloud_backup_read_chunk", { token, index }),
  begin: (manifest) => invoke("cloud_backup_begin_download", { manifest }),
  accept: (token, index, data) =>
    invoke("cloud_backup_accept_chunk", { token, index, data }),
  finish: (token) => invoke("cloud_backup_finish_download", { token }),
  release: (token) => invoke("cloud_backup_release", { token }),
};
export function cloudError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const messages: Record<string, string> = {
    "auth/invalid-credential": "邮箱或密码不正确。",
    "auth/email-already-in-use": "这个邮箱已经注册，请直接登录。",
    "auth/invalid-email": "请输入有效的邮箱地址。",
    "auth/weak-password": "密码至少需要 6 个字符。",
    "auth/configuration-not-found":
      "云端邮箱登录尚未启用，请联系维护者完成配置。",
    "auth/operation-not-allowed": "云端尚未开启邮箱密码登录，请联系维护者。",
    "auth/too-many-requests": "尝试次数过多，请稍后重试。",
    "auth/network-request-failed": "无法连接账户服务，请检查网络后重试。",
    "permission-denied": "云服务拒绝了请求，请确认邮箱已验证及项目权限已部署。",
    "resource-exhausted": "云服务配额已用完，请保留本机备份，稍后重试。",
    unavailable: "云服务暂时无法连接，本机数据已保留。",
  };
  return (
    messages[code] ??
    (error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "云服务操作失败，本机数据已保留。")
  );
}
