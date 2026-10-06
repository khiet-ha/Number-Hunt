import type { KeyValueStore } from "@/multiplayer/env";

/** Per-tab session (sessionStorage): survives reload, not shared between tabs. */
export interface Session {
  roomId: string;
  id: string;
  name: string;
  secret: string;
  secretHash: string;
}

const SESSION_KEY = "nh:session";
const NAME_KEY = "nh:name";

export function randomToken(len: number, alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const newRoomId = () => randomToken(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
export const newPlayerId = () => `p_${randomToken(8)}`;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function newSession(roomId: string, name: string, id = newPlayerId()): Promise<Session> {
  const secret = randomToken(24);
  return { roomId, id, name, secret, secretHash: await sha256Hex(secret) };
}

export function loadSession(store: KeyValueStore): Session | null {
  try {
    const raw = store.get(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(store: KeyValueStore, s: Session | null): void {
  if (s) store.set(SESSION_KEY, JSON.stringify(s));
  else store.remove(SESSION_KEY);
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* private mode */
  }
}

/** sessionStorage wrapped as KeyValueStore, falling back to memory. */
export function sessionStore(): KeyValueStore {
  const mem = new Map<string, string>();
  const ok = (() => {
    try {
      sessionStorage.setItem("nh:probe", "1");
      sessionStorage.removeItem("nh:probe");
      return true;
    } catch {
      return false;
    }
  })();
  return ok
    ? {
        get: (k) => sessionStorage.getItem(k),
        set: (k, v) => sessionStorage.setItem(k, v),
        remove: (k) => sessionStorage.removeItem(k),
      }
    : { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v), remove: (k) => void mem.delete(k) };
}
