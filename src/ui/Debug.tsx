import type { AppController } from "@/app/controller"
import type { NodeView } from "@/multiplayer/node"
import { useTicker } from "./hooks"

/** Debug overlay (?debug=1): leadership, log position, links, last protocol events. */
export function Debug({ c, v }: { c: AppController; v: NodeView | null }) {
  useTicker(500)
  const entries = c.logger.entries.slice(-14).reverse()
  return (
    <aside class="debug">
      {v && (
        <div>
          <b>{v.selfId}</b> {v.status} · term {v.term} · leader{" "}
          {v.leaderId ?? "-"} · idx {v.state?.logIndex ?? 0} · quorum{" "}
          {v.aliveCount}/{v.quorum}
          <div>
            {v.peers
              .map((p) => `${p.id}:${p.link}${p.alive ? "" : "✗"}`)
              .join(" ")}
          </div>
        </div>
      )}
      <pre>
        {entries
          .map(
            (e) =>
              `${new Date(e.t).toISOString().slice(17, 23)} ${e.dir === "in" ? "←" : e.dir === "out" ? "→" : "·"} ${e.type} t${e.term}${e.index != null ? ` #${e.index}` : ""}${e.peer ? ` ${e.peer}` : ""}${e.note ? ` ${e.note}` : ""}`
          )
          .join("\n")}
      </pre>
    </aside>
  )
}
