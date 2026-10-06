import type { PlayerId } from "@/game/types";
import { LIMITS } from "@/game/types";
import { minifySdp, pack, unpack } from "./codec";

/**
 * QR bootstrap envelopes (design 06 §2-3). Keys are short to keep QR codes small.
 *
 * Expiry is checked on the Host's own clock against the invite it created
 * (nonce), never against the other device's clock.
 */
export const QR_VERSION = 2;
export const INVITE_TTL_MS = 5 * 60 * 1000;
const ANSWER_PREFIX = "NH2:";

export type InviteKind = "join" | "rejoin";

export interface OfferEnvelope {
  v: typeof QR_VERSION;
  t: "o";
  /** roomId */
  r: string;
  /** id of the peer that created the offer (Host for join, any member for rejoin) */
  h: PlayerId;
  /** invite nonce */
  n: string;
  k: InviteKind;
  /** SDP */
  s: string;
}

export interface AnswerEnvelope {
  v: typeof QR_VERSION;
  t: "a";
  r: string;
  h: PlayerId;
  n: string;
  /** playerId */
  p: PlayerId;
  /** player name */
  m: string;
  /** join: SHA-256(secret); rejoin: the secret itself (proves identity) */
  x: string;
  s: string;
}

const isStr = (v: unknown, max = 8192): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export async function encodeOffer(o: Omit<OfferEnvelope, "v" | "t">): Promise<string> {
  return pack(JSON.stringify({ v: QR_VERSION, t: "o", ...o, s: minifySdp(o.s) }));
}

export async function encodeAnswer(a: Omit<AnswerEnvelope, "v" | "t">): Promise<string> {
  return ANSWER_PREFIX + (await pack(JSON.stringify({ v: QR_VERSION, t: "a", ...a, s: minifySdp(a.s) })));
}

export function offerUrl(base: string, packed: string): string {
  return `${base.split("#")[0]}#j=${packed}`;
}

/** Accepts a full invite URL, a "#j=..." fragment, or the bare packed string. */
export async function decodeOffer(input: string): Promise<OfferEnvelope> {
  const m = input.trim().match(/[#&]j=([A-Za-z0-9_-]+)/);
  const packed = m ? m[1] : input.trim();
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(await unpack(packed));
  } catch {
    throw new Error("Mã mời không hợp lệ");
  }
  if (o.v !== QR_VERSION) throw new Error("Phiên bản mã mời không hỗ trợ");
  if (o.t !== "o" || !isStr(o.r, 16) || !isStr(o.h, 64) || !isStr(o.n, 32) || !isStr(o.s)) throw new Error("Mã mời không hợp lệ");
  if (o.k !== "join" && o.k !== "rejoin") throw new Error("Mã mời không hợp lệ");
  return o as unknown as OfferEnvelope;
}

export async function decodeAnswer(input: string): Promise<AnswerEnvelope> {
  const s = input.trim();
  if (!s.startsWith(ANSWER_PREFIX)) throw new Error("Đây không phải mã trả lời của người chơi");
  let a: Record<string, unknown>;
  try {
    a = JSON.parse(await unpack(s.slice(ANSWER_PREFIX.length)));
  } catch {
    throw new Error("Mã trả lời không hợp lệ");
  }
  if (a.v !== QR_VERSION) throw new Error("Phiên bản mã trả lời không hỗ trợ");
  if (a.t !== "a" || !isStr(a.r, 16) || !isStr(a.h, 64) || !isStr(a.n, 32) || !isStr(a.p, 64) || !isStr(a.x, 128) || !isStr(a.s))
    throw new Error("Mã trả lời không hợp lệ");
  if (typeof a.m !== "string" || a.m.length > LIMITS.maxNameLength * 2) throw new Error("Tên người chơi không hợp lệ");
  return a as unknown as AnswerEnvelope;
}

export interface OpenInvite {
  nonce: string;
  kind: InviteKind;
  createdAt: number;
}

/** Host-side validation of a scanned answer against its open invite (W02-W04). */
export function checkAnswer(a: AnswerEnvelope, ctx: { roomId: string; selfId: PlayerId; invite: OpenInvite | undefined; now: number }): string | null {
  if (a.r !== ctx.roomId) return "Mã trả lời thuộc phòng khác";
  if (a.h !== ctx.selfId) return "Mã trả lời dành cho người khác";
  if (!ctx.invite || ctx.invite.nonce !== a.n) return "Mã mời đã được dùng hoặc không còn hiệu lực";
  if (ctx.now - ctx.invite.createdAt > INVITE_TTL_MS) return "Mã mời đã hết hạn";
  if (a.p === ctx.selfId) return "Không thể tự tham gia";
  return null;
}
