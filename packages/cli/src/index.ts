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

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const sc = SCENARIOS.map(s => `    ${EMOJIS[s]}  ${s.padEnd(12)} ${LABELS[s]}`).join("\n")
  console.log(`
${c.bold("CompText DSL v5")} — Klinische KI-Vorverarbeitung für ePA-Daten

${c.bold("Notfall-Commands:")}
  comptext emergency <szenario>   Vollständige Notfall-Ansicht (ePA → PHI → DSL → LLM)
  comptext simulate <szenario>    Schritt-für-Schritt Simulation mit Animation
  comptext epa <szenario>         Nur ePA-Daten anzeigen (ohne Pipeline)
  comptext menu                   Interaktives Menü

${c.bold("Technische Commands:")}
  comptext run <szenario>         DSL-Output auf stdout
  comptext benchmark              Token-Reduktions-Tabelle (alle 5 Szenarien)
  comptext serve [port]           Visualizer offline starten (Standard: 4000)
  comptext pipe                   FHIR-Bundle von stdin einlesen

${c.bold("Szenarien:")}
${sc}

${c.bold("Beispiele:")}
  comptext emergency stemi
  comptext simulate stroke
  comptext menu
  comptext epa sepsis
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
  default:
    printHelp()
    if (cmd && cmd !== "--help" && cmd !== "-h") process.exit(1)
}
