import type { LinkState } from "@/multiplayer/env";

/**
 * One RTCPeerConnection + one reliable, ordered DataChannel.
 * Knows nothing about players, scores or Hosts (agent rule 9).
 */

export interface PeerLinkOptions {
  iceServers: RTCIceServer[];
  /** Max time to wait for non-trickle ICE gathering. */
  gatherTimeoutMs: number;
}

export const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly dc: RTCDataChannel;
  state: LinkState = "connecting";
  onState: (s: LinkState) => void = () => {};
  onMessage: (data: string) => void = () => {};

  constructor(private readonly opts: PeerLinkOptions) {
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers });
    // Negotiated channel: both sides create it, no ondatachannel race.
    this.dc = this.pc.createDataChannel("game", { negotiated: true, id: 0, ordered: true });
    this.dc.onopen = () => this.set("connected");
    this.dc.onclose = () => this.set("closed");
    this.dc.onmessage = (e) => {
      if (typeof e.data === "string") this.onMessage(e.data);
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === "disconnected") this.set("disconnected");
      else if (s === "failed") this.set("failed");
      else if (s === "closed") this.set("closed");
      else if (s === "connected" && this.dc.readyState === "open") this.set("connected");
    };
  }

  private set(s: LinkState) {
    if (this.state === s || this.state === "closed") return;
    this.state = s;
    this.onState(s);
  }

  /** Non-trickle: resolve with the complete SDP once ICE gathering finished (design 06 §4). */
  private gathered(): Promise<string> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.pc.removeEventListener("icegatheringstatechange", check);
        resolve(this.pc.localDescription?.sdp ?? "");
      };
      const check = () => {
        if (this.pc.iceGatheringState === "complete") done();
      };
      const timer = setTimeout(done, this.opts.gatherTimeoutMs);
      this.pc.addEventListener("icegatheringstatechange", check);
      check();
    });
  }

  async createOffer(): Promise<string> {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    return this.gathered();
  }

  async acceptOffer(sdp: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: "offer", sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    return this.gathered();
  }

  async acceptAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: "answer", sdp });
  }

  send(data: string): boolean {
    if (this.dc.readyState !== "open") return false;
    try {
      this.dc.send(data);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    try {
      this.dc.close();
      this.pc.close();
    } catch {
      /* already closed */
    }
    this.set("closed");
  }
}
