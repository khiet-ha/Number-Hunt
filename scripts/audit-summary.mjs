// Renders `pnpm audit --json` output as a markdown table for the CI job
// summary and the weekly audit issue.
//
// Usage: node scripts/audit-summary.mjs <full.json> <prod.json>
//
// Advisories present in the prod report are flagged as shipping in the
// built site; the rest only affect dev tooling. An unreadable or empty
// report (registry outage) is reported as "no data", never as "clean".
import { readFileSync } from "node:fs"

const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"]

function read(path) {
  try {
    const raw = readFileSync(path, "utf8").trim()
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const escape = (s) =>
  String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")

const [fullPath, prodPath] = process.argv.slice(2)
const full = read(fullPath)
const prod = read(prodPath)
const out = []

out.push("## Dependency audit", "")
if (!full || typeof full.advisories !== "object") {
  out.push("_Không đọc được kết quả audit (registry lỗi?) — không có dữ liệu._")
  console.log(out.join("\n"))
  process.exit(0)
}

const prodIds = new Set(Object.keys(prod?.advisories ?? {}))
const advisories = Object.entries(full.advisories)
  .map(([id, a]) => ({ id, ...a, inProd: prodIds.has(id) }))
  .sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      Number(b.inProd) - Number(a.inProd)
  )

if (advisories.length === 0) {
  out.push("Không có advisory nào. ✅")
  console.log(out.join("\n"))
  process.exit(0)
}

const counts = SEVERITY_ORDER.map(
  (s) => `${s}: ${advisories.filter((a) => a.severity === s).length}`
).join(" · ")
out.push(
  `**${advisories.length}** advisory (${counts}) — **${advisories.filter((a) => a.inProd).length}** ở nhánh production.`,
  ""
)
out.push("| Severity | Package | Advisory | Nhánh | Đường dẫn |")
out.push("|---|---|---|---|---|")
for (const a of advisories) {
  const ghsa = a.github_advisory_id ?? `#${a.id}`
  const link = a.url ? `[${escape(ghsa)}](${a.url})` : escape(ghsa)
  const paths = (a.findings ?? []).flatMap((f) => f.paths ?? [])
  const shown = paths
    .slice(0, 2)
    .map((p) => `\`${escape(p)}\``)
    .join("<br>")
  const more = paths.length > 2 ? ` (+${paths.length - 2})` : ""
  out.push(
    `| ${a.severity} | ${escape(a.module_name)} | ${link} ${escape(a.title)} | ${a.inProd ? "**prod**" : "dev"} | ${shown}${more} |`
  )
}
console.log(out.join("\n"))
