import type { PlayerId } from "@/game/types";

/**
 * Abstractions the multiplayer core depends on. The core never touches
 * RTCPeerConnection, timers or storage directly, so it runs unchanged on top of
 * WebRTC in the browser and on top of the simulated network in tests.
 */

export type LinkState = "none" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

export interface TransportHandlers {
  onMessage(from: PlayerId, data: string): void;
  onLinkState(peer: PlayerId, state: LinkState): void;
}

export interface Transport {
  setHandlers(h: TransportHandlers): void;
  /** Returns false if there is no open link to `to`. */
  send(to: PlayerId, data: string): boolean;
  linkState(peer: PlayerId): LinkState;
  /** Peers with an open DataChannel. */
  openPeers(): PlayerId[];
  /** Optional: relayed signaling for mesh links (absent in the simulator). */
  dial?(peer: PlayerId): Promise<string>;
  acceptDial?(peer: PlayerId, offerSdp: string): Promise<string>;
  completeDial?(peer: PlayerId, answerSdp: string): Promise<void>;
  close(peer: PlayerId): void;
  closeAll(): void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private m = new Map<string, string>();
  get(k: string) {
    return this.m.get(k) ?? null;
  }
  set(k: string, v: string) {
    this.m.set(k, v);
  }
  remove(k: string) {
    this.m.delete(k);
  }
}

export interface LogEntry {
  t: number;
  dir: "in" | "out" | "local";
  type: string;
  term: number;
  index?: number;
  messageId?: string;
  peer?: PlayerId;
  note?: string;
}

/** Ring-buffer structured log (agent rule 12). Never logs SDP. */
export class EventLogger {
  readonly entries: LogEntry[] = [];
  constructor(
    private readonly max = 300,
    private readonly sink?: (e: LogEntry) => void,
  ) {}
  log(e: LogEntry): void {
    this.entries.push(e);
    if (this.entries.length > this.max) this.entries.shift();
    this.sink?.(e);
  }
}

/** Small LRU set used for messageId / requestId de-duplication. */
export class LruSet {
  private m = new Map<string, true>();
  constructor(private readonly max: number) {}
  has(k: string): boolean {
    return this.m.has(k);
  }
  add(k: string): void {
    this.m.delete(k);
    this.m.set(k, true);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
}
