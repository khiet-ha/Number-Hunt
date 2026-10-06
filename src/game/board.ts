import type { GameConfig } from "./types";
import { mixSeed, mulberry32, randInt, shuffle } from "./rng";

/**
 * Deterministic board layout: position = generateBoard(seed, layoutVersion, targets).
 *
 * All coordinates are integers in "board units" (BOARD_W x BOARD_H, aspect 3:4).
 * The UI scales units to pixels, so every device renders the same layout.
 */
export const BOARD_W = 3000;
export const BOARD_H = 4000;

export interface Cell {
  number: number;
  /** Centre, board units. */
  x: number;
  y: number;
  /** Font size in board units. */
  size: number;
  /** Rotation in degrees. */
  rotate: number;
}

export function gridFor(count: number): { cols: number; rows: number } {
  // Pick cols/rows so cells are roughly square on a 3:4 board.
  let cols = Math.max(1, Math.ceil(Math.sqrt((count * BOARD_W) / BOARD_H)));
  let rows = Math.ceil(count / cols);
  while (cols * rows < count) rows++;
  return { cols, rows };
}

export function generateBoard(
  seed: number,
  layoutVersion: number,
  targets: readonly number[],
  sizeMode: GameConfig["sizeMode"],
): Cell[] {
  const { cols, rows } = gridFor(targets.length);
  const cw = Math.floor(BOARD_W / cols);
  const ch = Math.floor(BOARD_H / rows);
  const base = Math.min(cw, ch);
  const next = mulberry32(mixSeed(seed, layoutVersion, 0xb0a7d));
  const slots = shuffle(
    Array.from({ length: cols * rows }, (_, i) => i),
    next,
  );
  // Size is a per-number property seeded independently of layout, so SMALL/LARGE
  // stay stable for a number even when the RANDOM mode re-lays out the board.
  return targets.map((number, i) => {
    const slot = slots[i];
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const sizeRng = mulberry32(mixSeed(seed, number, 0x51e));
    let pct: number;
    switch (sizeMode) {
      case "SMALL":
        pct = 34;
        break;
      case "LARGE":
        pct = 55;
        break;
      case "RANDOM":
        pct = 28 + randInt(sizeRng, 33); // 28..60 % of cell
        break;
    }
    const size = Math.floor((base * pct) / 100);
    // Jitter keeps the number fully inside its cell.
    const maxJx = Math.max(0, Math.floor((cw - size * 1.4) / 2));
    const maxJy = Math.max(0, Math.floor((ch - size) / 2));
    const jx = maxJx > 0 ? randInt(next, maxJx * 2 + 1) - maxJx : 0;
    const jy = maxJy > 0 ? randInt(next, maxJy * 2 + 1) - maxJy : 0;
    const rotate = randInt(next, 61) - 30;
    return {
      number,
      x: col * cw + Math.floor(cw / 2) + jx,
      y: row * ch + Math.floor(ch / 2) + jy,
      size,
      rotate,
    };
  });
}
