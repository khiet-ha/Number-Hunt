import type { PlayerId } from "@/game/types";
import type { LinkState, Transport, TransportHandlers } from "@/multiplayer/env";
import { PeerLink, type PeerLinkOptions } from "./peer";

/**
 * Map<PlayerId, PeerLink>. At most one link per remote player: a new link for
 * the same player replaces (and closes) the old one, and events from replaced
 * links are ignored (duplicate-connection prevention, W05).
 *
 * Events that arrive before the core attached its handlers are buffered.
 */
export class WebRtcTransport implements Transport {
  private links = new Map<PlayerId, PeerLink>();
  private handlers: TransportHandlers | null = null;
  private buffer: Array<(h: TransportHandlers) => void> = [];
  private openWaiters = new Map<PlayerId, Array<() => void>>();

  constructor(private readonly opts: PeerLinkOptions) {}

  setHandlers(h: TransportHandlers): void {
    this.handlers = h;
    const pending = this.buffer;
    this.buffer = [];
    for (const fn of pending) fn(h);
  }

  private emit(fn: (h: TransportHandlers) => void) {
    if (this.handlers) fn(this.handlers);
    else this.buffer.push(fn);
  }

  /** A link not yet associated with a player (QR invite in progress). */
  createUnbound(): PeerLink {
    return new PeerLink(this.opts);
  }

  /** Associate a link with a player; replaces any previous link. */
  bind(peer: PlayerId, link: PeerLink): void {
    const old = this.links.get(peer);
    if (old && old !== link) old.close();
    this.links.set(peer, link);
    link.onState = (s) => {
      if (this.links.get(peer) !== link) return;
      if (s === "connected") {
        const ws = this.openWaiters.get(peer) ?? [];
        this.openWaiters.delete(peer);
        ws.forEach((w) => w());
      }
      this.emit((h) => h.onLinkState(peer, s));
    };
    link.onMessage = (data) => {
      if (this.links.get(peer) !== link) return;
      this.emit((h) => h.onMessage(peer, data));
    };
    if (link.state === "connected") this.emit((h) => h.onLinkState(peer, "connected"));
  }

  waitOpen(peer: PlayerId, timeoutMs: number): Promise<void> {
    if (this.linkState(peer) === "connected") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      const list = this.openWaiters.get(peer) ?? [];
      list.push(() => {
        clearTimeout(t);
        resolve();
      });
      this.openWaiters.set(peer, list);
    });
  }

  send(to: PlayerId, data: string): boolean {
    return this.links.get(to)?.send(data) ?? false;
  }

  linkState(peer: PlayerId): LinkState {
    return this.links.get(peer)?.state ?? "none";
  }

  openPeers(): PlayerId[] {
    return [...this.links.entries()].filter(([, l]) => l.state === "connected").map(([p]) => p);
  }

  async dial(peer: PlayerId): Promise<string> {
    const link = this.createUnbound();
    this.bind(peer, link);
    return link.createOffer();
  }

  async acceptDial(peer: PlayerId, offerSdp: string): Promise<string> {
    const link = this.createUnbound();
    this.bind(peer, link);
    return link.acceptOffer(offerSdp);
  }

  async completeDial(peer: PlayerId, answerSdp: string): Promise<void> {
    const link = this.links.get(peer);
    if (!link || link.pc.signalingState !== "have-local-offer") return;
    await link.acceptAnswer(answerSdp);
  }

  close(peer: PlayerId): void {
    this.links.get(peer)?.close();
  }

  closeAll(): void {
    for (const l of this.links.values()) l.close();
  }
}
