/** Deterministic PRNG + hashing helpers. Never use Math.random() for replicated data. */

/** mulberry32: 32-bit state, integer-only, identical on every JS engine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}

/** Integer in [0, n). */
export function randInt(next: () => number, n: number): number {
  return next() % n
}

/** Combine integers into a 32-bit seed. */
export function mixSeed(...parts: number[]): number {
  let h = 0x811c9dc5
  for (const p of parts) {
    h ^= p >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
    h ^= h >>> 13
  }
  return h >>> 0
}

/** Fisher–Yates with a seeded generator. Returns a new array. */
export function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(next, i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** cyrb53 — fast 53-bit string hash, returned as hex. Used for state hashes. */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return n.toString(16).padStart(14, "0")
}
