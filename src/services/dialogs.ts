type Options = { title?: string; confirmLabel?: string };
export type DialogRequest = Options & {
  message: string;
  initialValue?: string;
  input: boolean;
};
let current: DialogRequest | null = null;
let finish: ((value: string | null) => void) | null = null;
const listeners = new Set<() => void>();
export const dialogState = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => current,
  answer(value: string | null) {
    const resolve = finish;
    current = null;
    finish = null;
    listeners.forEach((listener) => listener());
    resolve?.(value);
  },
};
function request(value: DialogRequest): Promise<string | null> {
  // Repeated clicks must not open another confirmation or approve an action.
  if (current) return Promise.resolve(null);
  return new Promise((resolve) => {
    current = value;
    finish = resolve;
    listeners.forEach((listener) => listener());
  });
}
export async function confirmAction(message: string, options: Options = {}) {
  return (await request({ message, ...options, input: false })) !== null;
}
export function requestText(
  message: string,
  initialValue = "",
  options: Options = {},
) {
  return request({ message, initialValue, ...options, input: true });
}
