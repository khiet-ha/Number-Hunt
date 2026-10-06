import type { GameConfig } from "./types";
import { mixSeed, mulberry32, randInt } from "./rng";

/**
 * Generate the full target sequence once at game start (design 02 §2).
 * Pure function of (config, seed).
 */
export function generateTargets(config: GameConfig, seed: number): number[] {
  const n = config.numberCount;
  const out: number[] = [];
  switch (config.numberMode) {
    case "SEQUENTIAL":
      for (let i = 0; i < n; i++) out.push(i + 1);
      return out;
    case "FIXED_STEP":
      for (let i = 0; i < n; i++) out.push(1 + i * config.step);
      return out;
    case "RANDOM_STEP": {
      const next = mulberry32(mixSeed(seed, 0x7a26e7));
      const steps = config.randomSteps;
      let v = 1;
      for (let i = 0; i < n; i++) {
        out.push(v);
        v += steps[randInt(next, steps.length)];
      }
      return out;
    }
  }
}
