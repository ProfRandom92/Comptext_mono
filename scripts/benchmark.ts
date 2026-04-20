import { pipelineAll, TOKEN_BENCHMARKS, serializeFrame } from "@comptext/core"
import type { PipelineResult } from "@comptext/core"

const LABELS: Record<string, string> = {
  stemi:      "STEMI (I21.09)",
  sepsis:     "Sepsis (A41.9)",
  stroke:     "Stroke (I63.3)",
  anaphylaxie:"Anaphylaxis (T78.2)",
  dm_hypo:    "DM Hypo (E11.64)",
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

function row(...cells: string[]): string {
  return "| " + cells.join(" | ") + " |"
}

async function main() {
  console.log("\n🔬 CompText Token Benchmark — DSL v5\n")
  console.log("Running pipeline on all 5 clinical scenarios...\n")

  const t0 = Date.now()
  const results = await pipelineAll()
  const elapsed = Date.now() - t0

  // ── Token reduction table ──────────────────────────────────────────────────
  console.log("## Token Reduction (GPT-4 cl100k_base reference vs. runtime estimate)\n")
  const cols = ["Scenario", "FHIR Raw", "NURSE", "KVTC", "Frame", "Est%", "Ref%", "Δ", "✓"]
  const sep  = cols.map((_, i) => "-".repeat([20,8,8,6,6,6,6,5,3][i] ?? 6))
  console.log(row(...cols.map((c, i) => pad(c, [20,8,8,6,6,6,6,5,3][i] ?? 6))))
  console.log(row(...sep))

  for (const [id, result] of Object.entries(results) as [string, PipelineResult][]) {
    const ref  = TOKEN_BENCHMARKS[id]
    const est  = result.benchmark.reduction_pct
    const refPct = ref?.gpt4_reduction_pct ?? 0
    const delta = Math.abs(est - refPct).toFixed(1)
    const ok    = parseFloat(delta) <= 2.0 ? "✅" : "⚠️"

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

  // ── Latency table ──────────────────────────────────────────────────────────
  console.log("\n## Inference Latency — MedGemma 27B (A100 40GB, batch=1)\n")
  const lCols = ["Scenario", "Raw FHIR", "CompText", "Improvement"]
  const lSep  = lCols.map((_, i) => "-".repeat([20,9,9,11][i] ?? 9))
  console.log(row(...lCols.map((c, i) => pad(c, [20,9,9,11][i] ?? 9))))
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

  // ── DSL output sample (STEMI) ──────────────────────────────────────────────
  const stemi = results["stemi"]
  if (stemi) {
    console.log("\n## DSL Output Sample — STEMI\n```")
    console.log(serializeFrame(stemi.frame))
    console.log("```")
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const avgReduction = Object.values(results)
    .reduce((sum, r) => sum + r.benchmark.reduction_pct, 0) / Object.keys(results).length

  console.log(`\n✅ All ${Object.keys(results).length} scenarios completed in ${elapsed}ms`)
  console.log(`📊 Average token reduction: ${avgReduction.toFixed(1)}%`)
  console.log(`🔒 All frames GDPR compliant: ${Object.values(results).every(r => r.benchmark.gdpr_compliant)}\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
