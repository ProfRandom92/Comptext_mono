import {
  pipeline, pipelineAll, serializeFrame,
  ALL_FHIR_BUNDLES, TOKEN_BENCHMARKS,
} from "@comptext/core"
import type { FHIRBundle, PipelineResult } from "@comptext/core"
import { createServer } from "node:http"
import { readFileSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { fileURLToPath } from "node:url"

const SCENARIOS = ["stemi", "sepsis", "stroke", "anaphylaxie", "dm_hypo"] as const
type Scenario = typeof SCENARIOS[number]

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".map":  "application/json",
  ".ico":  "image/x-icon",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
}

const LABELS: Record<string, string> = {
  stemi:       "STEMI (I21.09)",
  sepsis:      "Sepsis (A41.9)",
  stroke:      "Stroke (I63.3)",
  anaphylaxie: "Anaphylaxis (T78.2)",
  dm_hypo:     "DM Hypo (E11.64)",
}

function pad(s: string, n: number) { return s.length >= n ? s : s + " ".repeat(n - s.length) }
function row(...cells: string[])   { return "| " + cells.join(" | ") + " |" }

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdRun(scenario: string) {
  if (!SCENARIOS.includes(scenario as Scenario)) {
    process.stderr.write(`Unknown scenario: ${scenario}\nAvailable: ${SCENARIOS.join(", ")}\n`)
    process.exit(1)
  }
  const result = await pipeline(ALL_FHIR_BUNDLES[scenario as Scenario])
  process.stdout.write(serializeFrame(result.frame) + "\n")
  process.stderr.write(
    `\n[${scenario}] ${result.benchmark.reduction_pct.toFixed(1)}% reduction` +
    ` | GDPR: ${result.benchmark.gdpr_compliant ? "✓" : "✗"}` +
    ` | ${result.benchmark.phi_fields_scrubbed} PHI fields scrubbed\n`
  )
}

async function cmdBenchmark() {
  console.log("\n🔬 CompText Token Benchmark — DSL v5\n")
  const t0 = Date.now()
  const results = await pipelineAll()
  const elapsed = Date.now() - t0

  console.log("## Token Reduction\n")
  const cols = ["Scenario", "FHIR Raw", "NURSE", "KVTC", "Frame", "Est%", "Ref%", "Δ", "✓"]
  const widths = [20, 8, 8, 6, 6, 6, 6, 5, 3]
  const sep = cols.map((_, i) => "-".repeat(widths[i] ?? 6))
  console.log(row(...cols.map((c, i) => pad(c, widths[i] ?? 6))))
  console.log(row(...sep))

  for (const [id, result] of Object.entries(results) as [string, PipelineResult][]) {
    const ref     = TOKEN_BENCHMARKS[id]
    const est     = result.benchmark.reduction_pct
    const refPct  = ref?.gpt4_reduction_pct ?? 0
    const delta   = Math.abs(est - refPct).toFixed(1)
    const ok      = parseFloat(delta) <= 2.0 ? "✅" : "⚠️"
    console.log(row(
      pad(LABELS[id] ?? id, 20),
      pad(String(result.input.token_count), 8),
      pad(String(result.nurse.token_out), 8),
      pad(String(result.kvtc.token_out), 6),
      pad(String(ref?.gpt4_comptext ?? "?"), 6),
      pad(est.toFixed(1) + "%", 6),
      pad(refPct.toFixed(1) + "%", 6),
      pad("±" + delta, 5),
      ok,
    ))
  }

  console.log("\n## Latency — MedGemma 27B (reference)\n")
  const lCols = ["Scenario", "Raw FHIR", "CompText", "Improvement"]
  const lWidths = [20, 9, 9, 11]
  const lSep = lCols.map((_, i) => "-".repeat(lWidths[i] ?? 9))
  console.log(row(...lCols.map((c, i) => pad(c, lWidths[i] ?? 9))))
  console.log(row(...lSep))
  for (const [id] of Object.entries(results)) {
    const ref = TOKEN_BENCHMARKS[id]
    if (!ref) continue
    console.log(row(
      pad(LABELS[id] ?? id, 20),
      pad(ref.latency_raw_ms + " ms", 9),
      pad(ref.latency_comptext_ms + " ms", 9),
      pad(ref.latency_reduction_pct.toFixed(1) + "% faster", 11),
    ))
  }

  const avgReduction = Object.values(results)
    .reduce((s, r) => s + r.benchmark.reduction_pct, 0) / Object.keys(results).length
  console.log(`\n✅ ${Object.keys(results).length} scenarios in ${elapsed}ms`)
  console.log(`📊 Average reduction: ${avgReduction.toFixed(1)}%`)
  console.log(`🔒 GDPR compliant: ${Object.values(results).every(r => r.benchmark.gdpr_compliant)}\n`)
}

async function cmdPipe() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const json = Buffer.concat(chunks).toString("utf8")
  let bundle: FHIRBundle
  try {
    bundle = JSON.parse(json) as FHIRBundle
  } catch {
    process.stderr.write("Error: invalid JSON on stdin\n")
    process.exit(1)
  }
  const result = await pipeline(bundle)
  process.stdout.write(
    JSON.stringify({ frame: result.frame, dsl: serializeFrame(result.frame), benchmark: result.benchmark }, null, 2) + "\n"
  )
}

function cmdServe(portArg?: string) {
  const port   = parseInt(portArg ?? "4000", 10)
  const pkgDir = fileURLToPath(new URL("..", import.meta.url))
  const distDir = join(pkgDir, "..", "visualizer", "dist")

  if (!existsSync(join(distDir, "index.html"))) {
    process.stderr.write(
      "Visualizer not built.\nRun: npm run build -w packages/visualizer\n"
    )
    process.exit(1)
  }

  const server = createServer((req, res) => {
    let urlPath = req.url ?? "/"
    if (urlPath === "/" || !urlPath.includes(".")) urlPath = "/index.html"
    const filePath = join(distDir, urlPath)

    if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
      res.writeHead(302, { Location: "/" })
      res.end()
      return
    }

    const mime = MIME[extname(filePath)] ?? "application/octet-stream"
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" })
    res.end(readFileSync(filePath))
  })

  server.listen(port, "0.0.0.0", () => {
    console.log(`\nCompText Visualizer:`)
    console.log(`  http://127.0.0.1:${port}   (lokal)`)
    console.log(`  http://localhost:${port}     (Browser)\n`)
    console.log("Ctrl+C zum Beenden.")
  })
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
CompText DSL v5 — Clinical AI Preprocessing

Usage:
  comptext run <scenario>      Run a built-in FHIR scenario, output DSL
  comptext benchmark           Full benchmark table (all 5 scenarios)
  comptext serve [port]        Serve the visualizer offline (default: 4000)
  comptext pipe                Read FHIR bundle JSON from stdin, output result

Scenarios: ${SCENARIOS.join(", ")}

Examples:
  comptext run stemi
  comptext serve 8080
  cat patient.json | comptext pipe
  comptext benchmark > report.md
`)
}

// ── Router ────────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2)

switch (cmd) {
  case "run":
    if (!rest[0]) { process.stderr.write("Usage: comptext run <scenario>\n"); process.exit(1) }
    await cmdRun(rest[0])
    break
  case "benchmark":
    await cmdBenchmark()
    break
  case "pipe":
    await cmdPipe()
    break
  case "serve":
    cmdServe(rest[0])
    break
  default:
    printHelp()
    if (cmd && cmd !== "--help" && cmd !== "-h") process.exit(1)
}
