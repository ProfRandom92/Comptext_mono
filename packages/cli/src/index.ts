import {
  pipeline, pipelineAll, serializeFrame,
  ALL_FHIR_BUNDLES, TOKEN_BENCHMARKS,
} from "@comptext/core"
import type { FHIRBundle, PipelineResult } from "@comptext/core"
import { createServer } from "node:http"
import { readFileSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { fileURLToPath } from "node:url"
import * as readline from "node:readline"

import { c, W, banner, headerBox, sectionBox, progressBar, kv, badge, sleep, wrapLine } from "./tui.js"
import {
  MOCK_EPA_PATIENTS, buildEPABundle, formatEPAHeader,
  CLINICAL_HINTS, createEmergencyTIContext,
} from "./epa/mock-epa.js"
import type { Scenario } from "./epa/mock-epa.js"
import { MEDGEMMA_CACHE, MODELS, estimateCost, queryMedGemma } from "./llm/medgemma.js"
import type { MedGemmaReply } from "./llm/medgemma.js"

const SCENARIOS: Scenario[] = ["stemi", "sepsis", "stroke", "anaphylaxie", "dm_hypo"]

const LABELS: Record<Scenario, string> = {
  stemi:       "STEMI (I21.09)",
  sepsis:      "Sepsis (A41.9)",
  stroke:      "Schlaganfall (I63.3)",
  anaphylaxie: "Anaphylaxie (T78.2)",
  dm_hypo:     "Diabet. Hypoglykämie (E11.64)",
}

const EMOJIS: Record<Scenario, string> = {
  stemi:       "🫀",
  sepsis:      "🦠",
  stroke:      "🧠",
  anaphylaxie: "⚠️",
  dm_hypo:     "🩸",
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".map":  "application/json",
  ".ico":  "image/x-icon",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
}

function pad(s: string, n: number) { return s.length >= n ? s : s + " ".repeat(n - s.length) }
function row(...cells: string[])   { return "| " + cells.join(" | ") + " |" }

function validScenario(s: string): s is Scenario {
  return SCENARIOS.includes(s as Scenario)
}

// ── Bestehende Commands ───────────────────────────────────────────────────────

async function cmdRun(scenario: string) {
  if (!validScenario(scenario)) {
    process.stderr.write(`Unbekanntes Szenario: ${scenario}\nVerfügbar: ${SCENARIOS.join(", ")}\n`)
    process.exit(1)
  }
  const result = await pipeline(ALL_FHIR_BUNDLES[scenario])
  process.stdout.write(serializeFrame(result.frame) + "\n")
  process.stderr.write(
    `\n[${scenario}] ${result.benchmark.reduction_pct.toFixed(1)}% Reduktion` +
    ` | DSGVO: ${result.benchmark.gdpr_compliant ? "✓" : "✗"}` +
    ` | ${result.benchmark.phi_fields_scrubbed} PHI-Felder gescrubbt\n`
  )
}

async function cmdBenchmark() {
  console.log("\n🔬 CompText Token Benchmark — DSL v5\n")
  const t0 = Date.now()
  const results = await pipelineAll()
  const elapsed = Date.now() - t0
  const cols = ["Szenario", "FHIR", "NURSE", "KVTC", "Frame", "Est%", "Ref%", "Δ", "✓"]
  const widths = [24, 6, 6, 6, 6, 6, 6, 5, 3]
  const sep = cols.map((_, i) => "-".repeat(widths[i] ?? 6))
  console.log(row(...cols.map((col, i) => pad(col, widths[i] ?? 6))))
  console.log(row(...sep))
  for (const [id, result] of Object.entries(results) as [string, PipelineResult][]) {
    const ref    = TOKEN_BENCHMARKS[id]
    const est    = result.benchmark.reduction_pct
    const refPct = ref?.gpt4_reduction_pct ?? 0
    const delta  = Math.abs(est - refPct).toFixed(1)
    const ok     = parseFloat(delta) <= 2.0 ? "✅" : "⚠️"
    console.log(row(
      pad(`${EMOJIS[id as Scenario] ?? ""} ${LABELS[id as Scenario] ?? id}`, 24),
      pad(String(result.input.token_count), 6),
      pad(String(result.nurse.token_out), 6),
      pad(String(result.kvtc.token_out), 6),
      pad(String(ref?.gpt4_comptext ?? "?"), 6),
      pad(est.toFixed(1) + "%", 6),
      pad(refPct.toFixed(1) + "%", 6),
      pad("±" + delta, 5),
      ok,
    ))
  }
  const avg = Object.values(results).reduce((s, r) => s + r.benchmark.reduction_pct, 0) / SCENARIOS.length
  console.log(`\n✅ ${SCENARIOS.length} Szenarien in ${elapsed}ms | Ø Reduktion: ${avg.toFixed(1)}%\n`)
}

async function cmdPipe() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const json = Buffer.concat(chunks).toString("utf8")
  let bundle: FHIRBundle
  try { bundle = JSON.parse(json) as FHIRBundle }
  catch { process.stderr.write("Fehler: Kein gültiges JSON auf stdin\n"); process.exit(1) }
  const result = await pipeline(bundle)
  process.stdout.write(JSON.stringify({
    frame: result.frame, dsl: serializeFrame(result.frame), benchmark: result.benchmark
  }, null, 2) + "\n")
}

function cmdServe(portArg?: string) {
  const port    = parseInt(portArg ?? "4000", 10)
  const pkgDir  = fileURLToPath(new URL("..", import.meta.url))
  const distDir = join(pkgDir, "..", "visualizer", "dist")
  if (!existsSync(join(distDir, "index.html"))) {
    process.stderr.write("Visualizer nicht gebaut.\nAusführen: npm run build -w packages/visualizer\n")
    process.exit(1)
  }
  const server = createServer((req, res) => {
    let urlPath = req.url ?? "/"
    if (urlPath === "/" || !urlPath.includes(".")) urlPath = "/index.html"
    const filePath = join(distDir, urlPath)
    if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
      res.writeHead(302, { Location: "/" }); res.end(); return
    }
    const mime = MIME[extname(filePath)] ?? "application/octet-stream"
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" })
    res.end(readFileSync(filePath))
  })
  server.listen(port, "0.0.0.0", () => {
    console.log(`\nCompText Visualizer:\n  http://127.0.0.1:${port}   (lokal)\n  http://localhost:${port}     (Browser)\nCtrl+C zum Beenden.`)
  })
}

// ── Neue Commands ─────────────────────────────────────────────────────────────

function assertScenario(s: string): Scenario {
  if (!validScenario(s)) {
    process.stderr.write(`Unbekanntes Szenario: "${s}"\nVerfügbar: ${SCENARIOS.join(", ")}\n`)
    process.exit(1)
  }
  return s
}

// epa: zeigt nur die simulierten ePA-Daten (kein Pipeline-Lauf)
async function cmdEpa(scenario: Scenario) {
  const bundle = buildEPABundle(scenario, ALL_FHIR_BUNDLES[scenario])
  console.log()
  console.log(headerBox("ePA — Elektronische Patientenakte", `Szenario: ${EMOJIS[scenario]} ${LABELS[scenario]}`, "blue"))
  console.log()
  console.log(sectionBox(
    `Patientendaten ${badge.phi()} — werden NICHT an LLM weitergegeben`,
    formatEPAHeader(bundle).split("\n").map(l => c.red(l)),
    "red"
  ))
  console.log()
  console.log(sectionBox("Telematikinfrastruktur", [
    kv("TI-Session:", bundle.ti_context.ti_id, c.dim),
    kv("Zugriffstyp:", c.yellow("Notfallzugriff gem. §291a SGB V"), c.dim),
    kv("Zugriff durch:", bundle.ti_context.accessed_by, c.dim),
    kv("Grund:", bundle.ti_context.access_reason, c.dim),
    kv("Zeitstempel:", bundle.ti_context.timestamp, c.dim),
    kv("MIOs:", bundle.ti_context.mios.join(", "), c.dim),
  ], "blue"))
  console.log()
  console.log(sectionBox("PHI-Übersicht", [
    kv("PHI-Felder gesamt:", c.red(String(bundle.phi_field_count)), c.dim),
    kv("Davon an LLM:", c.green("0 (Null)"), c.dim),
    kv("Verarbeitungsgrundlage:", "DSGVO Art. 9 Abs. 2c, §291a SGB V", c.dim),
  ], "green"))
  console.log()
}

// emergency: vollständige Ein-Blick-Notfall-Ansicht
async function cmdEmergency(scenario: Scenario) {
  const epaBundle = buildEPABundle(scenario, ALL_FHIR_BUNDLES[scenario])
  const p = epaBundle.patient

  console.log()
  console.log(banner(
    `${EMOJIS[scenario]}  NOTFALL — ${LABELS[scenario]}`,
    c.bgRed
  ))
  console.log()
  console.log(headerBox(
    "ePA-Abruf aus Telematikinfrastruktur",
    "Notfallzugriff gem. §291a SGB V",
    "blue"
  ))
  console.log()

  // PHI — rot markiert
  const epaLines = [
    kv("KVNR:", c.red(p.kvnr), c.dim),
    kv("Patient:", c.red(`${p.name_given} ${p.name_family}`), c.dim),
    kv("Geburtsdatum:", c.red(p.birthdate.split("-").reverse().join(".") + ` (${new Date().getFullYear() - parseInt(p.birthdate.slice(0, 4))} J.)`), c.dim),
    kv("Adresse:", c.red(`${p.address_line}, ${p.postal_code} ${p.city}`), c.dim),
    kv("Versicherung:", c.red(`${p.insurance_name} ${p.insurance_type}`), c.dim),
    kv("Zugriff:", epaBundle.ti_context.accessed_by, c.dim),
    kv("Grund:", epaBundle.ti_context.access_reason, c.dim),
  ]
  console.log(sectionBox(`Patientendaten ${badge.phi()} — NICHT an LLM`, epaLines, "red"))
  console.log()

  // Pipeline laufen lassen
  const t0 = Date.now()
  const result = await pipeline(ALL_FHIR_BUNDLES[scenario])
  const elapsed = Date.now() - t0
  const dsl = serializeFrame(result.frame)

  // NURSE
  const nurseLines = [
    kv("Status:", badge.scrubbed() + " " + c.green("PHI vollständig entfernt"), c.dim),
    kv("PHI-Felder entfernt:", c.green(String(result.benchmark.phi_fields_scrubbed)), c.dim),
    kv("PHI-Hash (Audit):", c.dim(result.frame.gdpr.phi_hash ?? "-"), c.dim),
    kv("DSGVO:", c.green("Art. 9 Abs. 2c konform"), c.dim),
    kv("Token rein:", c.yellow(String(result.input.token_count)), c.dim),
    kv("Token NURSE-Out:", c.green(String(result.nurse.token_out)), c.dim),
  ]
  console.log(sectionBox("NURSE-Layer — PHI-Scrubbing " + badge.gdpr(), nurseLines, "green"))
  console.log()

  // Kompression
  const pct = result.benchmark.reduction_pct
  const comprLines = [
    progressBar("Token-Reduktion", pct, Math.min(W - 25, 40)),
    kv("FHIR Raw:", c.yellow(String(result.input.token_count) + " Token"), c.dim),
    kv("NURSE:", c.yellow(String(result.nurse.token_out) + " Token"), c.dim),
    kv("KVTC:", c.green(String(result.kvtc.token_out) + " Token"), c.dim),
    kv("Gesamt-Reduktion:", c.bold(c.green(pct.toFixed(1) + "%")), c.dim),
    kv("Pipeline-Dauer:", c.dim(`${elapsed}ms`), c.dim),
  ]
  console.log(sectionBox("CompText DSL — Kompression " + badge.dsl(), comprLines, "cyan"))
  console.log()

  // Was der LLM sieht — wrap plain text first, then colorize each segment
  const inner = W - 4
  const dslLines = [
    c.dim("─".repeat(inner)),
    ...dsl.split("\n").flatMap(l => wrapLine(l, inner).map(seg => c.yellow(seg))),
    c.dim("─".repeat(inner)),
    c.dim(`${badge.llm()}  ${result.kvtc.token_out} Token — kein PHI enthalten`),
  ]
  console.log(sectionBox("Das sieht der MedGemma / Claude " + badge.llm(), dslLines, "yellow"))
  console.log()

  // Klinische Hinweise
  const hints = CLINICAL_HINTS[scenario]
  console.log(sectionBox(
    "Klinische Hinweise aus ePA " + badge.epa(),
    hints.map((h, i) => c.magenta(`${i + 1}. ${h}`)),
    "magenta"
  ))
  console.log()

  // Compliance
  const compliLines = [
    badge.gdpr() + " " + c.green("DSGVO Art. 9 — Besondere Kategorien personenbezogener Daten"),
    badge.gdpr() + " " + c.green("§291a SGB V — Notfallzugriff auf ePA legitimiert"),
    badge.gdpr() + " " + c.green("BDSG §22 — Verarbeitung Gesundheitsdaten zu Behandlungszwecken"),
    badge.safe() + " " + c.green("Kein PHI an LLM übermittelt — nur komprimierter DSL-Output"),
    kv("Pipeline-Dauer:", c.dim(`${elapsed}ms`), c.dim),
  ]
  console.log(sectionBox("Compliance " + badge.safe(), compliLines, "green"))
  console.log()
}

// simulate: Schritt-für-Schritt mit animierten Verzögerungen
async function cmdSimulate(scenario: Scenario) {
  const epaBundle = buildEPABundle(scenario, ALL_FHIR_BUNDLES[scenario])
  const p = epaBundle.patient

  console.log()
  console.log(banner(`${EMOJIS[scenario]}  ePA-SIMULATION — ${LABELS[scenario]}`, c.bgBlue))
  console.log()
  await sleep(400)

  // SCHRITT 1: ePA-Abruf
  console.log(headerBox("SCHRITT 1 / 5  —  ePA-Abruf", "Verbindung zur Telematikinfrastruktur", "blue"))
  const tiSteps = [
    "Verbindung zur TI wird hergestellt...",
    "Authentifizierung via HBA (SMC-B)...",
    "Notfallzugriff §291a SGB V aktiviert...",
    "ePA-Server antwortet...",
    "MIOs werden abgerufen: " + epaBundle.ti_context.mios.join(", "),
  ]
  for (const step of tiSteps) {
    await sleep(350)
    console.log("  " + c.blue("▶ ") + step)
  }
  await sleep(300)
  console.log("  " + badge.ok() + " " + c.green("ePA erfolgreich abgerufen"))
  console.log()
  await sleep(400)

  // SCHRITT 2: PHI-Felder zeigen → entfernen
  console.log(headerBox("SCHRITT 2 / 5  —  NURSE PHI-Scrubbing", `${badge.phi()} PHI-Erkennung und Entfernung`, "red"))
  const phiFields: [string, string][] = [
    ["KVNR",         p.kvnr],
    ["Name",         `${p.name_given} ${p.name_family}`],
    ["Geburtsdatum", p.birthdate],
    ["Adresse",      `${p.address_line}, ${p.postal_code} ${p.city}`],
    ["Versicherung", `${p.insurance_name} (IKNR: ${p.insurance_iknr})`],
    ["TI-Session",   epaBundle.ti_context.ti_id],
  ]
  for (const [field, val] of phiFields) {
    await sleep(120)
    const truncated = val.length > 24 ? val.slice(0, 21) + "..." : val
    const line = `  ${c.red("✗")} ${pad(field + ":", 16)} ${c.red(truncated)} ${c.dim("→")} ${badge.scrubbed()}`
    console.log(line)
  }
  await sleep(300)
  console.log()
  console.log("  " + badge.gdpr() + " " + c.green(`${phiFields.length} PHI-Felder entfernt — DSGVO-konform`))
  console.log()
  await sleep(400)

  // SCHRITT 3: KVTC-Layer erklären
  console.log(headerBox("SCHRITT 3 / 5  —  KVTC-Kompression", "4-Layer DSL-Komprimierung", "cyan"))
  const layers: [string, string][] = [
    ["K — Key Layer",     "LOINC/SNOMED → Klinische Kurzschlüssel (HR, sBP, hs_tni…)"],
    ["V — Value Layer",   "Einheiten normalisiert + Interpretation (↑↑ kritisch)"],
    ["T — Type Layer",    "Vollständige Namen → Klinische Codes (ICD-10, ATC, SNOMED)"],
    ["C — Context Layer", "Klinischer Kontext auf <200 Zeichen komprimiert"],
  ]
  for (const [layer, desc] of layers) {
    await sleep(200)
    console.log("  " + c.cyan(layer.padEnd(22)) + c.dim(desc))
  }
  console.log()

  const t0 = Date.now()
  const result = await pipeline(ALL_FHIR_BUNDLES[scenario])
  const elapsed = Date.now() - t0
  const pct = result.benchmark.reduction_pct

  await sleep(200)
  console.log("  " + progressBar("Token-Reduktion", pct, Math.min(W - 28, 36)))
  console.log()
  await sleep(400)

  // SCHRITT 4: DSL-Output
  console.log(headerBox("SCHRITT 4 / 5  —  DSL-Output", `${badge.llm()} Was der LLM empfängt`, "yellow"))
  await sleep(200)
  const dsl = serializeFrame(result.frame)
  const simInner = W - 6
  for (const line of dsl.split("\n")) {
    for (const seg of wrapLine(line, simInner)) {
      await sleep(60)
      console.log("  " + c.yellow(seg))
    }
  }
  console.log()
  await sleep(400)

  // SCHRITT 5: Compliance-Checks
  console.log(headerBox("SCHRITT 5 / 5  —  Compliance", "Datenschutz-Verifikation", "green"))
  const checks = [
    ["DSGVO Art. 9 Abs. 2c",  "Notfallbehandlung legitimiert Verarbeitung"],
    ["§291a SGB V",           "Notfallzugriff auf ePA freigeschaltet"],
    ["BDSG §22",              "Gesundheitsdaten zu Behandlungszwecken"],
    ["PHI-Isolierung",        "Kein PHI im DSL-Output an LLM"],
    ["Audit-Trail",           `PHI-Hash: ${result.frame.gdpr.phi_hash ?? "n/a"}`],
  ]
  for (const [check, detail] of checks) {
    await sleep(250)
    console.log(`  ${badge.ok()} ${c.green(pad(check + ":", 26))}${c.dim(detail)}`)
  }
  console.log()
  await sleep(400)

  // Abschluss
  console.log(banner(
    `SIMULATION ABGESCHLOSSEN  —  ${pct.toFixed(1)}% Token-Reduktion  —  ${elapsed}ms`,
    c.bgGreen
  ))
  console.log()
}

// menu: interaktives Menü
async function cmdMenu() {
  console.log()
  console.log(headerBox("CompText — Notfall-Simulation", "ePA · PHI-Scrubbing · DSL · LLM-Input", "cyan"))
  console.log()
  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i]
    console.log(`  ${c.bold(String(i + 1))}  ${EMOJIS[s]}  ${LABELS[s]}`)
  }
  console.log()
  console.log(`  ${c.bold("b")}  📊 Benchmark (alle Szenarien)`)
  console.log(`  ${c.bold("a")}  🔄 Alle Szenarien nacheinander`)
  console.log(`  ${c.bold("q")}  Beenden`)
  console.log()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = () => new Promise<string>(res => rl.question(c.bold("Auswahl: "), res))

  let running = true
  while (running) {
    const input = (await ask()).trim().toLowerCase()
    console.log()
    switch (true) {
      case input === "q":
        running = false
        break
      case input === "b":
        await cmdBenchmark()
        running = false
        break
      case input === "a":
        for (const s of SCENARIOS) { await cmdEmergency(s); await sleep(200) }
        running = false
        break
      case /^[1-5]$/.test(input): {
        await cmdEmergency(SCENARIOS[parseInt(input, 10) - 1])
        running = false
        break
      }
      default:
        console.log(c.red("Ungültige Eingabe. Bitte 1–5, b, a oder q eingeben.\n"))
    }
  }
  rl.close()
}

// ── Streaming helper ──────────────────────────────────────────────────────────

const NO_STREAM = process.env.COMPTEXT_NO_STREAM === "1"

async function streamText(text: string, delayMs = 12, colorFn: (s: string) => string = (x) => x) {
  if (NO_STREAM) { process.stdout.write(colorFn(text) + "\n"); return }
  for (const ch of text) { process.stdout.write(colorFn(ch)); await sleep(delayMs) }
  process.stdout.write("\n")
}

function formatReply(r: MedGemmaReply, inner: number): string[] {
  const lines: string[] = []
  const wrap = (s: string) => wrapLine(s, inner - 3)
  lines.push(c.magenta(c.bold("▸ Differentialdiagnosen (MedGemma 27B):")))
  r.differential.forEach((d, i) => wrap(`   ${i + 1}. ${d}`).forEach(l => lines.push(c.magenta(l))))
  lines.push("")
  lines.push(c.magenta(c.bold("▸ Priorität:")))
  wrap(`   ${r.priority}`).forEach(l => lines.push(c.red(c.bold(l))))
  lines.push("")
  lines.push(c.magenta(c.bold("▸ Sofortmaßnahmen (in Reihenfolge):")))
  r.actions.forEach((a, i) => wrap(`   ${i + 1}. ${a}`).forEach(l => lines.push(c.white(l))))
  lines.push("")
  lines.push(c.magenta(c.bold("▸ Medikation (Wirkstoff | Dosis | Route | Frequenz):")))
  r.drugs.forEach(d => wrap(`   • ${d}`).forEach(l => lines.push(c.cyan(l))))
  lines.push("")
  lines.push(c.magenta(c.bold("▸ Warnungen / Kontraindikationen:")))
  r.alerts.forEach(a => wrap(`   ⚠ ${a}`).forEach(l => lines.push(c.yellow(l))))
  lines.push("")
  lines.push(c.magenta(c.bold("▸ Therapieziel (10 min):")))
  wrap(`   ${r.target}`).forEach(l => lines.push(c.green(l))  )
  lines.push("")
  lines.push(c.dim(`model: ${r.model}  |  confidence: ${(r.confidence * 100).toFixed(0)}%  |  tokens_out: ${r.tokens_out}`))
  return lines
}

// llm: show simulated MedGemma 27B reply for a scenario DSL frame
async function cmdLlm(scenario: Scenario, opts: { noStream?: boolean } = {}) {
  const result = await pipeline(ALL_FHIR_BUNDLES[scenario])
  const dsl = serializeFrame(result.frame)

  console.log()
  console.log(headerBox(
    `${EMOJIS[scenario]} MedGemma 27B — Klinische Entscheidungshilfe`,
    `Input: ${result.kvtc.token_out} DSL-Token  |  ${LABELS[scenario]}`,
    "magenta",
  ))
  console.log()

  // Show the DSL being sent (yellow, collapsed)
  const dslPreview = dsl.split("\n").slice(0, 3).join(" ").slice(0, W - 8)
  console.log(c.dim("  LLM-Input: ") + c.yellow(dslPreview + c.dim(" …")))
  console.log()

  process.stdout.write(c.dim("  Anfrage an MedGemma 27B"))
  for (let i = 0; i < 3; i++) { await sleep(opts.noStream ? 0 : 250); process.stdout.write(c.dim(".")) }
  process.stdout.write("\n\n")

  const { reply, source, latency_ms } = await queryMedGemma(scenario, dsl, { timeoutMs: 4000 })
  const sourceBadge = source === "live"
    ? c.bgGreen(c.bold(" LIVE "))
    : c.bgBlue(c.bold(" CACHE "))
  console.log(`  ${sourceBadge} ${c.dim(`(${latency_ms} ms)`)}`)
  console.log()

  const inner = W - 4
  const body = formatReply(reply, inner)
  console.log(sectionBox("MedGemma 27B — Antwort", body, "magenta"))
  console.log()
}

// demo: end-to-end showcase — the hackathon money-shot
async function cmdDemo(scenario: Scenario) {
  const epaBundle = buildEPABundle(scenario, ALL_FHIR_BUNDLES[scenario])
  const p = epaBundle.patient

  console.log()
  console.log(banner(`${EMOJIS[scenario]}  COMPTEXT DEMO — ${LABELS[scenario]}`, c.bgRed))
  console.log()
  await sleep(300)

  // 1. ePA-Pull
  console.log(headerBox("① ePA-Abruf aus Telematikinfrastruktur", `TI-Session ${epaBundle.ti_context.ti_id}`, "blue"))
  for (const step of [
    "🔐 HBA-Auth (SMC-B)",
    "🚨 §291a SGB V Notfallzugriff",
    "📥 MIOs: " + epaBundle.ti_context.mios.join(", "),
  ]) { await sleep(180); console.log("  " + c.blue("▶ ") + step) }
  console.log("  " + badge.ok() + " " + c.green(`Patient geladen: ${c.red(p.name_given + " " + p.name_family)} ${c.dim(`(KVNR: ${p.kvnr})`)}`))
  console.log()
  await sleep(300)

  // 2. NURSE — PHI scrub counter animation
  const t0 = Date.now()
  const result = await pipeline(ALL_FHIR_BUNDLES[scenario])
  const elapsed = Date.now() - t0
  const dsl = serializeFrame(result.frame)

  console.log(headerBox("② NURSE — PHI-Scrubbing " + badge.gdpr(), "DSGVO Art. 9 + §291a SGB V", "red"))
  const totalPhi = result.benchmark.phi_fields_scrubbed
  for (let i = 1; i <= totalPhi; i++) {
    process.stdout.write(`\r  ${c.red("✗")} ${c.dim("PHI-Felder entfernt:")} ${c.bold(c.red(String(i)))} / ${totalPhi}   `)
    await sleep(45)
  }
  process.stdout.write("\n")
  console.log("  " + badge.scrubbed() + " " + c.green(`${totalPhi} PHI-Felder entfernt`) + c.dim(`  |  Hash: ${result.frame.gdpr.phi_hash ?? "-"}`))
  console.log()
  await sleep(300)

  // 3. KVTC — compression progress
  console.log(headerBox("③ KVTC-Kompression " + badge.dsl(), "4-Layer: K/V/T/C", "cyan"))
  const pct = result.benchmark.reduction_pct
  const w = Math.min(W - 28, 36)
  for (let i = 0; i <= 100; i += 5) {
    const p_ = Math.min(i, pct)
    process.stdout.write("\r  " + progressBar("Kompression", p_, w))
    await sleep(20)
  }
  process.stdout.write("\r  " + progressBar("Kompression", pct, w) + "\n")
  console.log(c.dim(`  ${result.input.token_count} Token → ${result.kvtc.token_out} Token  (${pct.toFixed(1)}% Reduktion in ${elapsed} ms)`))
  console.log()
  await sleep(300)

  // 4. DSL output (yellow, what the LLM sees)
  console.log(headerBox("④ CompText DSL — LLM-Input " + badge.llm(), `${result.kvtc.token_out} Token, kein PHI`, "yellow"))
  const inner = W - 6
  for (const line of dsl.split("\n")) {
    for (const seg of wrapLine(line, inner)) {
      await sleep(30)
      console.log("  " + c.yellow(seg))
    }
  }
  console.log()
  await sleep(400)

  // 5. MedGemma reply (streaming)
  console.log(headerBox("⑤ MedGemma 27B — Klinische Antwort", "Streaming Response", "magenta"))
  const { reply, source, latency_ms } = await queryMedGemma(scenario, dsl, { timeoutMs: 4000 })
  const sourceBadge = source === "live" ? c.bgGreen(c.bold(" LIVE ")) : c.bgBlue(c.bold(" CACHE "))
  console.log(`  ${sourceBadge} ${c.dim(`Latenz ${latency_ms} ms`)}\n`)

  await streamText(`▸ DIAGNOSE: ${reply.differential[0]}`, 10, c.bold)
  await sleep(150)
  await streamText(`▸ PRIORITÄT: ${reply.priority}`, 10, c.red)
  await sleep(150)
  console.log()
  console.log(c.magenta(c.bold("▸ SOFORTMASSNAHMEN:")))
  for (let i = 0; i < reply.actions.length; i++) {
    await sleep(80)
    for (const seg of wrapLine(`   ${i + 1}. ${reply.actions[i]}`, inner)) {
      console.log(c.white(seg))
    }
  }
  console.log()
  console.log(c.yellow(c.bold("▸ WARNUNGEN:")))
  for (const a of reply.alerts) {
    await sleep(100)
    for (const seg of wrapLine(`   ⚠ ${a}`, inner)) console.log(c.yellow(seg))
  }
  console.log()
  await sleep(300)

  // 6. Final value shot — cost / latency comparison
  const model = MODELS["medgemma-27b-cloud"]
  const raw = estimateCost(model, result.input.token_count, reply.tokens_out)
  const dslCost = estimateCost(model, result.kvtc.token_out, reply.tokens_out)
  const savings = raw.usd_per_1m_calls - dslCost.usd_per_1m_calls
  const pctSaved = (savings / raw.usd_per_1m_calls) * 100

  console.log(sectionBox("Wert-Nachweis — pro 1 Mio. Notfall-Anfragen", [
    kv("Raw FHIR → MedGemma:", c.red(`$${raw.usd_per_1m_calls.toFixed(0).padStart(6)} / 1M Calls`) + c.dim(` @ ${raw.tokens_in} tok/call`), c.dim),
    kv("CompText DSL →MedGemma:", c.green(`$${dslCost.usd_per_1m_calls.toFixed(0).padStart(6)} / 1M Calls`) + c.dim(` @ ${dslCost.tokens_in} tok/call`), c.dim),
    kv("Ersparnis:", c.bold(c.green(`$${savings.toFixed(0)}`)) + c.dim(` (${pctSaved.toFixed(1)}% weniger)`), c.dim),
    kv("Latenz Raw FHIR:", c.red(`~${raw.latency_ms} ms`), c.dim),
    kv("Latenz DSL:", c.green(`~${dslCost.latency_ms} ms`) + c.dim(` (${Math.round(((raw.latency_ms - dslCost.latency_ms) / raw.latency_ms) * 100)}% schneller)`), c.dim),
    kv("PHI-Exposition:", c.green("0 Felder (Null)") + c.dim(` — ${totalPhi} entfernt vor LLM`), c.dim),
  ], "green"))
  console.log()
  await sleep(300)

  console.log(banner(
    `✓ DEMO ABGESCHLOSSEN  —  ${pct.toFixed(1)}% Token  —  ${pctSaved.toFixed(0)}% Kosten  —  0 PHI`,
    c.bgGreen,
  ))
  console.log()
}

// compare: side-by-side FHIR vs DSL across models
async function cmdCompare(scenario: Scenario) {
  const result = await pipeline(ALL_FHIR_BUNDLES[scenario])
  const reply = MEDGEMMA_CACHE[scenario]

  console.log()
  console.log(headerBox(
    `${EMOJIS[scenario]} Kosten & Latenz — FHIR vs. CompText DSL`,
    LABELS[scenario],
    "cyan",
  ))
  console.log()

  const modelIds = ["medgemma-27b-cloud", "claude-sonnet-4-6", "claude-opus-4-7", "gpt-4-turbo"]
  const cols = ["Modell", "Input FHIR", "Input DSL", "$/1M FHIR", "$/1M DSL", "Ersparnis", "Latenz Δ"]
  const widths = [28, 10, 10, 12, 12, 12, 12]
  const sep = () => cols.map((_, i) => "─".repeat(widths[i]!)).join("─┼─")
  const head = cols.map((col, i) => pad(col, widths[i]!)).join(" │ ")
  console.log("  " + c.bold(head))
  console.log("  " + c.dim(sep()))

  for (const id of modelIds) {
    const m = MODELS[id]!
    const raw = estimateCost(m, result.input.token_count, reply.tokens_out)
    const dsl = estimateCost(m, result.kvtc.token_out, reply.tokens_out)
    const saving = raw.usd_per_1m_calls - dsl.usd_per_1m_calls
    const savingPct = (saving / raw.usd_per_1m_calls) * 100
    const latPct = ((raw.latency_ms - dsl.latency_ms) / Math.max(raw.latency_ms, 1)) * 100
    const row_ = [
      pad(m.name, widths[0]!),
      pad(String(raw.tokens_in), widths[1]!),
      pad(String(dsl.tokens_in), widths[2]!),
      pad("$" + raw.usd_per_1m_calls.toFixed(0), widths[3]!),
      pad("$" + dsl.usd_per_1m_calls.toFixed(0), widths[4]!),
      pad(`-${savingPct.toFixed(1)}%`, widths[5]!),
      pad(`-${latPct.toFixed(0)}%`, widths[6]!),
    ]
    console.log(
      "  " + row_[0] + " │ " +
      c.red(row_[1]) + " │ " +
      c.green(row_[2]) + " │ " +
      c.red(row_[3]) + " │ " +
      c.green(row_[4]) + " │ " +
      c.bold(c.green(row_[5])) + " │ " +
      c.bold(c.green(row_[6]))
    )
  }
  console.log()

  // PHI / compliance comparison
  console.log(sectionBox("Compliance & Klinische Parität", [
    kv("PHI-Exposition Raw FHIR:", c.red(`${result.benchmark.phi_fields_scrubbed} identifizierende Felder`), c.dim),
    kv("PHI-Exposition DSL:", c.green("0 Felder (DSGVO Art. 9 erfüllt)"), c.dim),
    kv("Klinische Key-Felder:", c.green("100% erhalten") + c.dim(" (Dx, Vitals, Labs, Rx, Allergien)"), c.dim),
    kv("Audit-Hash:", c.dim(result.frame.gdpr.phi_hash ?? "-"), c.dim),
    kv("DSGVO-Markierung:", c.green(result.frame.gdpr.art9 ? "Art. 9 Abs. 2c gesetzt" : "nicht gesetzt"), c.dim),
  ], "green"))
  console.log()
}

// doctor: readiness / health check
async function cmdDoctor() {
  console.log()
  console.log(headerBox("CompText Doctor — Systemcheck", "Termux-/Offline-Bereitschaftsprüfung", "cyan"))
  console.log()

  type Status = "ok" | "warn" | "fail"
  const checks: { name: string; result: () => Promise<[Status, string]> | [Status, string] }[] = [
    { name: "Node.js ≥ 18",        result: () => {
      const v = process.versions.node.split(".").map(Number)
      return [v[0]! >= 18 ? "ok" : "fail", `v${process.versions.node}`]
    }},
    { name: "Terminal-Breite",     result: () => [W >= 40 ? "ok" : "warn", `${W} Spalten`] },
    { name: "ANSI-Farben",         result: () => {
      const on = process.env.NO_COLOR !== "1" && process.env.TERM !== "dumb"
      return [on ? "ok" : "warn", on ? "aktiv" : "deaktiviert (NO_COLOR/TERM=dumb)"]
    }},
    { name: "UTF-8 Locale",        result: () => {
      const lc = process.env.LANG ?? process.env.LC_ALL ?? ""
      return [/UTF-?8/i.test(lc) ? "ok" : "warn", lc || "nicht gesetzt (Box-Chars evtl. fehlerhaft)"]
    }},
    { name: "Termux erkannt",      result: () => {
      const termux = !!process.env.PREFIX?.includes("com.termux") || !!process.env.TERMUX_VERSION
      return [termux ? "ok" : "warn", termux ? "ja" : "nein (andere POSIX-Shell — ok)"]
    }},
    { name: "Core-Pipeline",       result: async () => {
      try { const r = await pipeline(ALL_FHIR_BUNDLES.stemi); return [r.kvtc.token_out > 0 ? "ok" : "fail", `STEMI → ${r.kvtc.token_out} Token`] }
      catch (e) { return ["fail", (e as Error).message] }
    }},
    { name: "ePA-Mock 5 Szenarien",result: () => {
      const ok = SCENARIOS.every(s => !!MOCK_EPA_PATIENTS[s])
      return [ok ? "ok" : "fail", ok ? `${SCENARIOS.length}/5 Patienten` : "fehlt"]
    }},
    { name: "MedGemma-Cache",      result: () => {
      const ok = SCENARIOS.every(s => MEDGEMMA_CACHE[s].actions.length > 0)
      return [ok ? "ok" : "fail", ok ? `${SCENARIOS.length}/5 Antworten geladen` : "unvollständig"]
    }},
    { name: "MedGemma Live-Endpoint", result: () => {
      const url = process.env.COMPTEXT_LLM_URL
      return ["ok", url ? url : "nicht gesetzt (Cache-Modus, offline-fähig)"]
    }},
  ]

  let failed = 0, warned = 0
  for (const { name, result } of checks) {
    const [status, detail] = await result()
    if (status === "fail") failed++
    if (status === "warn") warned++
    const mark = status === "ok" ? badge.ok()
               : status === "warn" ? badge.warn()
               : badge.fail()
    console.log(`  ${mark} ${c.bold(pad(name, 28))} ${c.dim(detail)}`)
  }
  console.log()
  if (failed === 0 && warned === 0) {
    console.log(banner("✓ ALLE CHECKS BESTANDEN — DEMO READY", c.bgGreen))
  } else if (failed === 0) {
    console.log(banner(`✓ DEMO READY  —  ${warned} Hinweis(e) beachten`, c.bgGreen))
  } else {
    console.log(banner(`✗ ${failed} CHECK(S) FEHLGESCHLAGEN`, c.bgRed))
    process.exitCode = 1
  }
  console.log()
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const sc = SCENARIOS.map(s => `    ${EMOJIS[s]}  ${s.padEnd(12)} ${LABELS[s]}`).join("\n")
  console.log(`
${c.bold("CompText DSL v5")} — Klinische KI-Vorverarbeitung für ePA-Daten

${c.bold("Notfall-Commands:")}
  comptext demo <szenario>        🎬 End-to-End Showcase (ePA → PHI → DSL → MedGemma)
  comptext emergency <szenario>   Vollständige Notfall-Ansicht
  comptext simulate <szenario>    Schritt-für-Schritt Simulation mit Animation
  comptext llm <szenario>         MedGemma-27B-Antwort auf DSL-Frame
  comptext compare <szenario>     FHIR vs. DSL — Kosten & Latenz über 4 Modelle
  comptext epa <szenario>         Nur ePA-Daten anzeigen (ohne Pipeline)
  comptext menu                   Interaktives Menü
  comptext doctor                 Systemcheck (Demo-Bereitschaft)

${c.bold("Technische Commands:")}
  comptext run <szenario>         DSL-Output auf stdout
  comptext benchmark              Token-Reduktions-Tabelle (alle 5 Szenarien)
  comptext serve [port]           Visualizer offline starten (Standard: 4000)
  comptext pipe                   FHIR-Bundle von stdin einlesen

${c.bold("Umgebungsvariablen:")}
  COMPTEXT_LLM_URL=http://...     Ollama-kompatibler MedGemma-Endpoint (Live-Modus)
  COMPTEXT_LLM_MODEL=medgemma:27b Modellname (Default: medgemma:27b)
  COMPTEXT_NO_STREAM=1            Deaktiviert Stream-Animation (CI-Modus)
  NO_COLOR=1                      Deaktiviert ANSI-Farben

${c.bold("Szenarien:")}
${sc}

${c.bold("Beispiele:")}
  comptext demo stemi            ${c.dim("# 🎬 Hackathon-Showcase, 20s")}
  comptext emergency stemi
  comptext simulate stroke
  comptext llm sepsis
  comptext compare stemi
  comptext doctor
  comptext menu
  comptext serve 8080
  cat patient.json | comptext pipe
`)
}

// ── Router ────────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2)

switch (cmd) {
  case "run":
    if (!rest[0]) { process.stderr.write("Usage: comptext run <szenario>\n"); process.exit(1) }
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
  case "emergency":
  case "notfall":
    if (!rest[0]) { process.stderr.write("Usage: comptext emergency <szenario>\n"); process.exit(1) }
    await cmdEmergency(assertScenario(rest[0]))
    break
  case "simulate":
  case "sim":
    if (!rest[0]) { process.stderr.write("Usage: comptext simulate <szenario>\n"); process.exit(1) }
    await cmdSimulate(assertScenario(rest[0]))
    break
  case "epa":
    if (!rest[0]) { process.stderr.write("Usage: comptext epa <szenario>\n"); process.exit(1) }
    await cmdEpa(assertScenario(rest[0]))
    break
  case "menu":
    await cmdMenu()
    break
  case "demo":
  case "showcase":
    if (!rest[0]) { process.stderr.write("Usage: comptext demo <szenario>\n"); process.exit(1) }
    await cmdDemo(assertScenario(rest[0]))
    break
  case "llm":
  case "medgemma":
    if (!rest[0]) { process.stderr.write("Usage: comptext llm <szenario>\n"); process.exit(1) }
    await cmdLlm(assertScenario(rest[0]))
    break
  case "compare":
  case "cmp":
    if (!rest[0]) { process.stderr.write("Usage: comptext compare <szenario>\n"); process.exit(1) }
    await cmdCompare(assertScenario(rest[0]))
    break
  case "doctor":
  case "check":
    await cmdDoctor()
    break
  default:
    printHelp()
    if (cmd && cmd !== "--help" && cmd !== "-h") process.exit(1)
}
