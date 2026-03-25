import { useState, useEffect, useCallback } from "react"
import {
  pipeline, serializeFrame,
  FHIR_STEMI, FHIR_SEPSIS, FHIR_STROKE, FHIR_ANAPHYLAXIE, FHIR_DM_HYPO,
  TOKEN_BENCHMARKS,
} from "@comptext/core"
import type { PipelineResult } from "@comptext/core"

// ── Scenario definitions ───────────────────────────────────────────────────────
type Scenario = {
  id: string
  benchKey: string
  label: string
  icd: string
  bundle: typeof FHIR_STEMI
  desc: string
}

const SCENARIOS: Scenario[] = [
  { id: "STEMI",   benchKey: "stemi",   label: "STEMI",         icd: "I21.09", bundle: FHIR_STEMI,       desc: "Cardiogenic shock, contrast allergy" },
  { id: "SEPSIS",  benchKey: "sepsis",  label: "Sepsis",         icd: "A41.9",  bundle: FHIR_SEPSIS,      desc: "Septic shock, Penicillin allergy" },
  { id: "STROKE",  benchKey: "stroke",  label: "Stroke",         icd: "I63.3",  bundle: FHIR_STROKE,      desc: "Acute ischaemic, NOAC contraindication" },
  { id: "ANAPH",   benchKey: "anaph",   label: "Anaphylaxis",    icd: "T78.2",  bundle: FHIR_ANAPHYLAXIE, desc: "Hymenoptera, bronchospasm risk" },
  { id: "DM-HYPO", benchKey: "dm-hypo", label: "DM Hypo",        icd: "E11.64", bundle: FHIR_DM_HYPO,    desc: "Severe hypoglycaemia, CKD" },
]

const TRIAGE_LABELS: Record<string, string> = {
  P1: "IMMEDIATE — Life threatening",
  P2: "URGENT — Potentially life threatening",
  P3: "DELAYED — Non life threatening",
  P4: "EXPECTANT",
}

const LAB_LABELS: Record<string, { label: string; unit: string }> = {
  hs_tni:    { label: "hsTroponin I",  unit: "ng/L" },
  ckmb:      { label: "CK-MB",         unit: "µg/L" },
  pct:       { label: "Procalcitonin", unit: "µg/L" },
  crp:       { label: "CRP",           unit: "mg/L" },
  lactate:   { label: "Lactate",       unit: "mmol/L" },
  glucose:   { label: "Glucose",       unit: "mmol/L" },
  egfr:      { label: "eGFR",          unit: "ml/min/1.73m²" },
  creatinine:{ label: "Creatinine",    unit: "µmol/L" },
  inr:       { label: "INR",           unit: "" },
  aptt:      { label: "aPTT",          unit: "s" },
  hb:        { label: "Hb",            unit: "g/dL" },
  wbc:       { label: "WBC",           unit: "10⁹/L" },
  plt:       { label: "PLT",           unit: "10⁹/L" },
}

const VS_LABELS: Record<string, { label: string; unit: string; critLow?: number; critHigh?: number }> = {
  hr:   { label: "HR",    unit: "/min",  critHigh: 150 },
  sbp:  { label: "sBP",   unit: "mmHg",  critLow: 90 },
  dbp:  { label: "dBP",   unit: "mmHg" },
  spo2: { label: "SpO₂",  unit: "%",     critLow: 90 },
  rr:   { label: "RR",    unit: "/min",  critHigh: 30 },
  temp: { label: "Temp",  unit: "°C" },
  gcs:  { label: "GCS",   unit: "",      critLow: 8 },
  map:  { label: "MAP",   unit: "mmHg",  critLow: 65 },
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function isCriticalVital(key: string, value: number): boolean {
  const meta = VS_LABELS[key]
  if (!meta) return false
  if (meta.critHigh !== undefined && value >= meta.critHigh) return true
  if (meta.critLow  !== undefined && value <= meta.critLow)  return true
  return false
}

function isCriticalLab(key: string, value: number): "high" | "low" | null {
  const thresholds: Record<string, [number, number]> = {
    hs_tni: [52, Infinity], ckmb: [10, Infinity],
    pct: [2, Infinity],     lactate: [2, Infinity],
    glucose: [3, 20],       egfr: [-Infinity, 15],
    hb: [-Infinity, 7],
  }
  const t = thresholds[key]
  if (!t) return null
  if (value > t[1]) return "high"
  if (value < t[0]) return "low"
  return null
}

function fmtNum(n: number | undefined): string {
  if (n === undefined) return "—"
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// ── Syntax-highlighted DSL ─────────────────────────────────────────────────────
function DSLOutput({ text, tri }: { text: string; tri: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const highlighted = text.split("\n").map((line, i) => {
    if (line.startsWith("CT:")) {
      // Color the TRI: part
      const parts = line.split(" ")
      return (
        <div key={i}>
          {parts.map((p, j) => {
            if (p.startsWith("TRI:")) return <span key={j}><span className="dsl-key">TRI:</span><span className={`dsl-triage-${tri}`}>{p.slice(4)} </span></span>
            const [k, v] = p.split(":")
            return <span key={j}><span className="dsl-key">{k}:</span><span className="dsl-value">{v} </span></span>
          })}
        </div>
      )
    }
    if (line.startsWith("ALG:") || line.startsWith("KI:")) {
      return <div key={i} className="dsl-alert">{line}</div>
    }
    if (line.startsWith("GDPR:") || line.startsWith("PHI:")) {
      return <div key={i} className="dsl-gdpr">{line}</div>
    }
    // generic key:value coloring
    return (
      <div key={i}>
        {line.split(" ").map((tok, j) => {
          const colon = tok.indexOf(":")
          if (colon > 0 && colon < tok.length - 1) {
            return <span key={j}><span className="dsl-key">{tok.slice(0, colon + 1)}</span><span className="dsl-value">{tok.slice(colon + 1)} </span></span>
          }
          return <span key={j}>{tok} </span>
        })}
      </div>
    )
  })

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-header">
        <div className="panel-title"><span className="dot dot-green" />DSL Output — MedGemma Input</div>
        <button className={`copy-btn ${copied ? "copied" : ""}`} onClick={copy}>
          {copied ? "✓ Kopiert" : "Kopieren"}
        </button>
      </div>
      <div className="panel-body">
        <div className="dsl-output">{highlighted}</div>
      </div>
    </div>
  )
}

// ── Pipeline Flow ──────────────────────────────────────────────────────────────
function PipelineFlow({ result, benchKey }: { result: PipelineResult; benchKey: string }) {
  const scenarioId = benchKey
  const bench = TOKEN_BENCHMARKS[scenarioId]
  const raw  = result.input.token_count
  const nurse= result.nurse.token_out
  const kvtc = result.kvtc.token_out
  const frame= result.frame._pipe?.tok_out ?? (bench?.gpt4_comptext ?? 112)

  const stages = [
    { label: "Stage 0", name: "FHIR Bundle",    tokens: raw,   cls: "raw",   desc: `${(result.input.fhir_bytes / 1024).toFixed(1)} KB JSON` },
    { label: "Stage 1", name: "NURSE",           tokens: nurse, cls: "nurse", desc: `${result.nurse.phi_fields_removed} PHI-Felder entfernt`, reduction: result.nurse.token_in > 0 ? ((1 - nurse / raw) * 100).toFixed(1) : null },
    { label: "Stage 2", name: "KVTC",            tokens: kvtc,  cls: "kvtc",  desc: "4-Layer Kompression", reduction: ((1 - kvtc / nurse) * 100).toFixed(1) },
    { label: "Stage 3", name: "Frame Assembly",  tokens: frame, cls: "frame", desc: `${result.frame.icd.length} ICD-10, ${result.frame.alg.length} ALG`, reduction: ((1 - frame / kvtc) * 100).toFixed(1) },
    { label: "Output",  name: "DSL String",      tokens: bench?.gpt4_comptext ?? frame, cls: "dsl", desc: "→ MedGemma 27B input", reduction: result.benchmark.reduction_pct.toFixed(1) },
  ]

  return (
    <div className="pipeline-flow">
      {stages.map((s) => (
        <div key={s.name} className="pipeline-stage">
          <div className="stage-label">{s.label}</div>
          <div className="stage-name">{s.name}</div>
          <div className={`stage-tokens ${s.cls}`}>{s.tokens} <span style={{ fontSize: "0.65rem", fontWeight: 400 }}>tok</span></div>
          {s.reduction && <div className="stage-reduction">↓ {s.reduction}%</div>}
          <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", marginTop: 2 }}>{s.desc}</div>
          <div className="stage-bar">
            <div
              className="stage-bar-fill"
              style={{
                width: `${(s.tokens / raw) * 100}%`,
                background: s.cls === "raw" ? "#484f58" : s.cls === "nurse" ? "#d29922" : s.cls === "kvtc" ? "#e3b341" : "#3fb950",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── KVTC Panel ─────────────────────────────────────────────────────────────────
function KVTCPanel({ result }: { result: PipelineResult }) {
  const [activeLayer, setActiveLayer] = useState<"K" | "V" | "T" | "C">("K")
  const { layer_k, layer_v, layer_t, layer_c } = result.kvtc

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title"><span className="dot dot-orange" />KVTC — 4-Layer Kompression</div>
        <div className="panel-badge">−{result.kvtc.token_in - result.kvtc.token_out} tok</div>
      </div>
      <div className="layer-tabs">
        {(["K", "V", "T", "C"] as const).map(l => (
          <button key={l} className={`layer-tab ${activeLayer === l ? "active" : ""}`} onClick={() => setActiveLayer(l)}>
            {l === "K" && "K — Keys"}
            {l === "V" && "V — Values"}
            {l === "T" && "T — Types"}
            {l === "C" && "C — Context"}
          </button>
        ))}
      </div>
      <div className="layer-content">
        {activeLayer === "K" && (
          <>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 8 }}>LOINC → CompText Schlüssel ({layer_k.pairs.length} Pairs, −{layer_k.token_saved} tok)</div>
            {layer_k.pairs.map((p) => (
              <div key={p.loinc} className="kv-row">
                <div>
                  <div className="kv-key">{p.display}</div>
                  <div className="kv-loinc">LOINC:{p.loinc}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span className="kv-value">{p.value} {p.unit}</span>
                  {p.interp && <span className={`kv-interp ${p.interp.includes("↑") ? "up" : p.interp.includes("↓") ? "down" : "normal"}`}>{p.interp}</span>}
                </div>
              </div>
            ))}
          </>
        )}
        {activeLayer === "V" && (
          <>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 8 }}>SI-Normalisierung + Kompaktnotation (−{layer_v.token_saved} tok)</div>
            {layer_v.normalized.map((n) => (
              <div key={n.key} className="kv-row">
                <span className="kv-key">{n.key}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {n.critical && <span className="tag tag-red">KRIT</span>}
                  <span className="kv-value" style={{ color: n.critical ? "var(--red)" : undefined }}>{n.compact}</span>
                </span>
              </div>
            ))}
          </>
        )}
        {activeLayer === "T" && (
          <>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 8 }}>FHIR ResourceType → CompText Code (−{layer_t.token_saved} tok)</div>
            {Object.entries(layer_t.encoded).map(([from, to]) => (
              <div key={from} className="type-row">
                <span className="type-from">{from}</span>
                <span className="type-arrow">→</span>
                <span className="type-to">{to}</span>
                <span className="type-saved">−{from.length - to.length} chars</span>
              </div>
            ))}
          </>
        )}
        {activeLayer === "C" && (
          <>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 10 }}>Klinische Abkürzungen (−{layer_c.token_saved} tok)</div>
            {layer_c.narrative ? (
              <div className="ctx-compressed">{layer_c.narrative}</div>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>Kein Kontext-Narrativ verfügbar</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── NURSE Panel ────────────────────────────────────────────────────────────────
function NURSEPanel({ result }: { result: PipelineResult }) {
  const { nurse } = result
  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title"><span className="dot dot-yellow" />NURSE — PHI Scrubbing</div>
        <div className="panel-badge">{nurse.token_in} → {nurse.token_out} tok</div>
      </div>
      <div className="panel-body">
        <div className="phi-stats" style={{ marginBottom: 14 }}>
          <div className="phi-stat">
            <div className="phi-stat-val">{nurse.phi_fields_removed}</div>
            <div className="phi-stat-label">PHI-Felder entfernt</div>
          </div>
          <div className="phi-stat">
            <div className="phi-stat-val" style={{ color: "var(--green)" }}>{nurse.resources.length}</div>
            <div className="phi-stat-label">Ressourcen erhalten</div>
          </div>
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginBottom: 6, fontFamily: "var(--mono)" }}>
          PHI Hash: {nurse.phi_hash} (FNV-1a, not reversible)
        </div>
        <div className="resource-list">
          {nurse.resources.map((r, i) => (
            <div key={i} className="resource-item">
              <span className={`resource-type ${r.type.replace("MedicationStatement", "MedicationStatement")}`}>
                {r.type === "MedicationStatement" ? "MED" : r.type.toUpperCase()}
              </span>
              <span className="resource-hash">{r.id_hash}</span>
              <div className="resource-fields">
                {Object.entries(r.fields).filter(([, v]) => v != null).slice(0, 6).map(([k, v]) => (
                  <span key={k} className="resource-field">
                    <span className="field-key">{k}:</span>
                    <span className="field-val"> {String(v).slice(0, 30)} </span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Safety Alerts Panel ────────────────────────────────────────────────────────
function SafetyAlertsPanel({ result }: { result: PipelineResult }) {
  const { frame } = result
  const SEV_LABELS: Record<string, string> = { "I": "Grad I — mild", "II": "Grad II — moderat", "III": "Grad III — schwer", "IV": "Grad IV — anaphylaktisch" }

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title"><span className="dot dot-red" />Safety Alerts — Nie komprimiert</div>
        <div className="panel-badge">{frame.alg.length} ALG / {frame.rx.length} RX</div>
      </div>
      <div className="panel-body">
        {frame.alg.length === 0 && frame.rx.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>Keine Safety-Alerts</div>
        )}
        {frame.alg.map((alg, i) => (
          <div key={i} className="alert-card allergy">
            <div className="alert-icon">⚠️</div>
            <div className="alert-content">
              <div className="alert-name">
                {alg.ag}
                {" "}<span className={`sev-badge ${alg.sev}`}>Sev. {alg.sev}</span>
              </div>
              <div className="alert-detail">{SEV_LABELS[alg.sev]}</div>
              {alg.rx && alg.rx.length > 0 && (
                <div className="alert-tags">
                  <span style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Kontraindiziert:</span>
                  {alg.rx.map(r => <span key={r} className="tag tag-red">{r}</span>)}
                </div>
              )}
              {alg.note && <div className="alert-detail" style={{ marginTop: 4 }}>{alg.note}</div>}
            </div>
          </div>
        ))}
        {frame.rx.map((rx, i) => (
          <div key={i} className="alert-card medication">
            <div className="alert-icon">💊</div>
            <div className="alert-content">
              <div className="alert-name">{rx.name} <span className="tag tag-blue" style={{ fontSize: "0.65rem" }}>ATC:{rx.atc}</span></div>
              <div className="alert-detail">{rx.dose} · {rx.freq}</div>
              {rx.ki && rx.ki.length > 0 && (
                <div className="alert-tags">
                  {rx.ki.map((k, j) => <span key={j} className="tag tag-yellow">{k}</span>)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Vitals + Labs Panel ────────────────────────────────────────────────────────
function VitalsLabsPanel({ result }: { result: PipelineResult }) {
  const { vs, lab } = result.frame
  const vitals = Object.entries(vs).filter(([, v]) => v !== undefined) as [string, number][]
  const labs = Object.entries(lab).filter(([, v]) => v !== undefined) as [string, number][]

  return (
    <>
      {vitals.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <div className="panel-title"><span className="dot dot-blue" />Vitalzeichen</div>
            <div className="panel-badge">{vitals.filter(([k, v]) => isCriticalVital(k, v)).length} kritisch</div>
          </div>
          <div className="panel-body">
            <div className="vitals-grid">
              {vitals.map(([key, val]) => {
                const meta = VS_LABELS[key] ?? { label: key, unit: "" }
                const crit = isCriticalVital(key, val)
                return (
                  <div key={key} className={`vital-card ${crit ? "critical" : ""}`}>
                    <div className="vital-label">{meta.label}</div>
                    <div className={`vital-value ${crit ? "critical" : ""}`}>{fmtNum(val)}</div>
                    {meta.unit && <div className="vital-unit">{meta.unit}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {labs.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title"><span className="dot dot-purple" />Laborwerte</div>
            <div className="panel-badge">{labs.filter(([k, v]) => isCriticalLab(k, v) !== null).length} kritisch</div>
          </div>
          <div className="panel-body">
            <table className="lab-table">
              <tbody>
                {labs.map(([key, val]) => {
                  const meta = LAB_LABELS[key] ?? { label: key, unit: "" }
                  const crit = isCriticalLab(key, val)
                  const interpSymbol = crit === "high" ? "↑↑" : crit === "low" ? "↓↓" : null
                  return (
                    <tr key={key}>
                      <td className="lab-name">{meta.label}</td>
                      <td className={`lab-value ${crit === "high" ? "critical-high" : crit === "low" ? "critical-low" : "normal"}`}>
                        {fmtNum(val)} {meta.unit}
                      </td>
                      <td className={`lab-interp ${crit === "high" ? "critical-high" : crit === "low" ? "critical-low" : ""}`}>
                        {interpSymbol}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ── Benchmark Panel ────────────────────────────────────────────────────────────
function BenchmarkPanel() {
  const ALL = [
    { key: "stemi",   label: "STEMI" },
    { key: "sepsis",  label: "Sepsis" },
    { key: "stroke",  label: "Stroke" },
    { key: "anaph",   label: "Anaph." },
    { key: "dm-hypo", label: "DM Hypo" },
  ]

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title"><span className="dot dot-green" />Token Benchmarks — cl100k_base (GPT-4)</div>
      </div>
      <div className="panel-body">
        {ALL.map(({ key, label }) => {
          const b = TOKEN_BENCHMARKS[key]
          if (!b) return null
          const pct = b.gpt4_reduction_pct
          return (
            <div key={key} className="benchmark-row">
              <div className="bench-label">{label}</div>
              <div className="bench-bar-wrap">
                <div
                  className="bench-bar"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, #1a3c2a, #3fb950)`,
                  }}
                />
              </div>
              <div className="bench-val">{pct.toFixed(1)}%</div>
              <div className="bench-tok">{b.gpt4_raw} → {b.gpt4_comptext}</div>
            </div>
          )
        })}
        <div style={{ marginTop: 12, fontSize: "0.7rem", color: "var(--text-dim)" }}>
          ⚡ MedGemma 27B Inferenz: ø 4434ms (raw) → 712ms (CompText) = 83.9% schneller
        </div>
      </div>
    </div>
  )
}

// ── Context + ICD Panel ────────────────────────────────────────────────────────
function ContextPanel({ result }: { result: PipelineResult }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title"><span className="dot dot-yellow" />Diagnosen & Kontext</div>
      </div>
      <div className="panel-body">
        {result.frame.icd.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 6 }}>ICD-10</div>
            <div className="icd-list">
              {result.frame.icd.map(c => <span key={c} className="icd-code">{c}</span>)}
            </div>
          </div>
        )}
        {result.frame.ctx && (
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 6 }}>Komprimierter Kontext</div>
            <div className="ctx-compressed">{result.frame.ctx}</div>
          </div>
        )}
        <div style={{ marginTop: 12, padding: "8px 10px", background: "var(--bg-card)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: "0.65rem", color: "var(--text-dim)", marginBottom: 4 }}>GDPR Compliance</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="gdpr-badge">GDPR Art. 9</span>
            <span className="gdpr-badge">PHI minimiert</span>
            <span className="gdpr-badge">One-way Hash</span>
            <span className="gdpr-hash">phi:{result.frame.gdpr.phi_hash}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [activeScenario, setActiveScenario] = useState<Scenario>(SCENARIOS[0])
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runPipeline = useCallback(async (scenario: Scenario) => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await pipeline(scenario.bundle)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    runPipeline(SCENARIOS[0])
  }, [runPipeline])

  const handleScenario = (s: Scenario) => {
    setActiveScenario(s)
    runPipeline(s)
  }

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="header-logo">
          <h1>CompText</h1>
          <span>DSL v5</span>
          <span style={{ background: "var(--blue-dim)", color: "var(--blue)", borderColor: "rgba(88,166,255,0.3)" }}>FHIR R4</span>
          <span style={{ background: "var(--purple-dim)", color: "var(--purple)", borderColor: "rgba(188,140,255,0.3)" }}>MedGemma</span>
        </div>
        <div className="header-meta">
          Clinical AI Token Preprocessing Pipeline · 93–94% Token-Reduktion
        </div>
      </div>

      {/* Scenario Selector */}
      <div className="scenario-selector">
        {SCENARIOS.map(s => (
          <button
            key={s.id}
            className={`scenario-btn ${activeScenario.id === s.id ? "active" : ""}`}
            onClick={() => handleScenario(s)}
          >
            <span>{s.label}</span>
            <span className="scenario-icd">{s.icd} · {s.desc}</span>
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="loading">
          <div className="spinner" />
          <div>Pipeline läuft... ({activeScenario.label})</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: 16, background: "var(--red-dim)", border: "1px solid rgba(248,81,73,0.3)", borderRadius: "var(--radius)", marginBottom: 16, color: "var(--red)" }}>
          Pipeline Fehler: {error}
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          {/* Triage Banner */}
          <div className={`triage-banner ${result.frame.tri}`}>
            <div className={`triage-class ${result.frame.tri}`}>{result.frame.tri}</div>
            <div className="triage-info">
              <div className="triage-scenario">{activeScenario.label} — {TRIAGE_LABELS[result.frame.tri]}</div>
              <div className="triage-desc">{activeScenario.desc} · {result.benchmark.reduction_pct.toFixed(1)}% Token-Reduktion · {result.benchmark.total_ms}ms</div>
            </div>
            <div className="triage-gdpr">
              <span className="gdpr-badge">GDPR ✓</span>
              <span className="gdpr-hash">{result.frame.gdpr.phi_hash}</span>
            </div>
          </div>

          {/* Pipeline Flow */}
          <PipelineFlow result={result} benchKey={activeScenario.benchKey} />

          {/* DSL Output */}
          <DSLOutput text={serializeFrame(result.frame)} tri={result.frame.tri} />

          {/* Safety Alerts + Vitals/Labs */}
          <div className="grid-2">
            <SafetyAlertsPanel result={result} />
            <div>
              <VitalsLabsPanel result={result} />
            </div>
          </div>

          {/* KVTC + NURSE */}
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <KVTCPanel result={result} />
            <NURSEPanel result={result} />
          </div>

          {/* Context + Benchmarks */}
          <div className="grid-2">
            <ContextPanel result={result} />
            <BenchmarkPanel />
          </div>
        </>
      )}
    </div>
  )
}
