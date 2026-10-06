import { expect, it } from "vitest";
import { createGame, target } from "./sim";

it("smoke: 3 players play one number", () => {
  const room = createGame(3);
  const b = room.node("p2");
  const t = target(b);
  expect(b.click(t)).toBe("sent");
  room.run(200);
  for (const n of room.live()) {
    expect(n.getView().state!.scores.p2).toBe(1);
  }
});
