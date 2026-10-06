import { useEffect, useReducer } from "preact/hooks";
import type { AppController } from "@/app/controller";

export function useController(c: AppController) {
  const [, force] = useReducer((x: number, _: unknown) => x + 1, 0);
  useEffect(() => c.subscribe(() => force(undefined)), [c]);
}

/** Re-render periodically (countdowns, liveness indicators). */
export function useTicker(ms: number, active = true) {
  const [, force] = useReducer((x: number, _: unknown) => x + 1, 0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force(undefined), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}
