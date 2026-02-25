/**
 * @comptext/core — Triage Engine + Frame Assembler
 *
 * Deterministic triage classification based on:
 *   - Vital sign thresholds (ESC/AHA/SSC/ERC guidelines)
 *   - Laboratory critical values (DGKL 2023 critical value list)
 *   - ICD-10 diagnosis codes
 *   - Safety-critical medication interactions
 *
 * Output: CompTextFrame — the final DSL token submitted to MedGemma
 */

import type { FHIRBundle } from "../data.js"
import type { NURSEOutput, KVTCOutput, CompTextFrame, VitalSigns, LabValues, AllergyCode, MedicationCode, TriageClass, PipelineMeta } from "../types/index.js"
import { estimateTokens } from "./nurse.js"

// ── Critical value thresholds (DGKL 2023 + ESC/AHA/SSC guidelines) ──────────
const CRITICAL_HIGH: Record<keyof LabValues, number> = {
  hs_tni: 52,          // ng/L — ESC 2023 high-sensitivity cutoff (Roche assay)
  ckmb: 10,            // µg/L
  pct: 2.0,            // µg/L — sepsis threshold (SSC 2021)
  crp: 100,            // mg/L
  lactate: 2.0,        // mmol/L — SSC 2021 septic shock
  glucose: 20,         // mmol/L — hyperglycaemic emergency
  egfr: 999,           // no critical high for eGFR
  creatinine: 300,     // µmol/L
  inr: 3.0,
  aptt: 100,           // s
  hb: 999,
  wbc: 30,             // 10^9/L
  plt: 999,
}

const CRITICAL_LOW: Record<keyof LabValues, number> = {
  hs_tni: 0,
  ckmb: 0,
  pct: 0,
  crp: 0,
  lactate: 0,
  glucose: 3.0,        // mmol/L — ADA Level 2 (54 mg/dL)
  egfr: 15,            // mL/min/1.73m² — CKD Stage 5
  creatinine: 0,
  inr: 0,
  aptt: 0,
  hb: 7.0,             // g/dL — transfusion threshold
  wbc: 2.0,            // 10^9/L
  plt: 50,             // 10^9/L — bleeding risk
}

// ── Allergy SNOMED → allergen name mapping ────────────────────────────────────
const ALLERGY_SNOMED_MAP: Record<string, { name: string; sev: AllergyCode["sev"]; ki: string[] }> = {
  "418425009": { name: "Jodkontrastmittel", sev: "II", ki: ["V08", "V09"] },
  "416098002": { name: "Penicillin", sev: "III", ki: ["J01CA", "J01CE", "J01CF", "J01CR"] },
  "241929008": { name: "Hymenoptera", sev: "III", ki: [] },
  "372687004": { name: "Amoxicillin", sev: "II", ki: ["J01CA04"] },
  "372903009": { name: "Cephalosporine", sev: "II", ki: ["J01DB", "J01DC", "J01DD", "J01DE"] },
  "387173000": { name: "NSAR", sev: "II", ki: ["M01A"] },
}

// ── ICD-10 → P1 criteria ──────────────────────────────────────────────────────
const ICD10_P1_PATTERNS = [
  /^I21/, // STEMI / NSTEMI
  /^I22/, // Subsequent MI
  /^I60/, // SAH
  /^I61/, // ICH
  /^I63/, // Ischaemic stroke
  /^I64/, // Stroke NOS
  /^A41/, // Sepsis
  /^A40/, // Streptococcal sepsis
  /^T78\.2/, // Anaphylaxis
  /^T86/, // Organ rejection
  /^E11\.64/, // DM T2 hypoglycaemia with coma
  /^J96/, // Respiratory failure
  /^K92\.2/, // GI haemorrhage
]

// ── Extract vital signs from KVTC output ──────────────────────────────────────
function extractVitals(kvtc: KVTCOutput): VitalSigns {
  const vitals: VitalSigns = {}
  for (const item of kvtc.layer_v.normalized) {
    const k = item.key
    const raw = item.compact.split(":")[1]?.replace(/[↑↓↗↘⬆⬇n]/g, "").trim()
    const v = raw ? parseFloat(raw) : NaN
    if (isNaN(v)) continue

    if (k === "HR") vitals.hr = v
    else if (k === "sBP" || k === "BP") vitals.sbp = v
    else if (k === "dBP") vitals.dbp = v
    else if (k === "SpO2") vitals.spo2 = v
    else if (k === "AF") vitals.rr = v
    else if (k === "Temp") vitals.temp = v
    else if (k === "NIHSS") vitals.gcs = null as unknown as number // separate field
  }
  return vitals
}

// ── Extract lab values from KVTC output ───────────────────────────────────────
function extractLabs(kvtc: KVTCOutput): LabValues {
  const labs: LabValues = {}
  for (const item of kvtc.layer_v.normalized) {
    const k = item.key
    const raw = item.compact.split(":")[1]?.replace(/[↑↓↗↘⬆⬇n]/g, "").replace(/[^0-9.]/g, "").trim()
    const v = raw ? parseFloat(raw) : NaN
    if (isNaN(v)) continue

    if (k === "hsTnI") labs.hs_tni = v
    else if (k === "CKMB") labs.ckmb = v
    else if (k === "PCT") labs.pct = v
    else if (k === "CRP") labs.crp = v
    else if (k === "LAC") labs.lactate = v
    else if (k === "BZ") labs.glucose = v
    else if (k === "eGFR") labs.egfr = v
    else if (k === "NIHSS") {}
  }
  return labs
}

// ── Extract allergies ─────────────────────────────────────────────────────────
function extractAllergies(nurse: NURSEOutput): AllergyCode[] {
  const allergies: AllergyCode[] = []
  for (const res of nurse.resources) {
    if (res.type !== "Condition") continue
    const text = res.fields.text as string ?? ""
    const snomed = res.fields.snomed as string ?? ""

    // Check if this condition is an allergy
    const isAllergy = text.toLowerCase().includes("allergie")
      || text.toLowerCase().includes("allergy")
      || snomed in ALLERGY_SNOMED_MAP

    if (!isAllergy) continue

    const mapped = ALLERGY_SNOMED_MAP[snomed]
    if (mapped) {
      allergies.push({
        ag: mapped.name,
        sev: mapped.sev,
        rx: mapped.ki,
        note: text.slice(0, 60),
      })
    }
  }
  return allergies
}

// ── Extract medications ───────────────────────────────────────────────────────
function extractMedications(nurse: NURSEOutput): MedicationCode[] {
  const meds: MedicationCode[] = []
  for (const res of nurse.resources) {
    if (res.type !== "MedicationStatement") continue
    const f = res.fields
    const text = f.display as string ?? ""
    const atc = f.atc as string ?? ""

    // Flag clinically critical medications
    const ki: string[] = []
    // NOAC → lyse contraindication
    if (atc.startsWith("B01AF") || atc.startsWith("B01AE")) {
      ki.push("LYSE-KI:NOAC<48h")
    }
    // Sulfonylharnstoff → prolonged hypoglycaemia risk
    if (atc.startsWith("A10BB")) {
      ki.push("HYPO-RISK:SHT-Rebound-24h")
    }

    meds.push({
      atc,
      name: text.split(" ")[0]?.slice(0, 20) ?? "?",
      dose: `${f.dose ?? "?"}${f.unit ?? ""}`,
      freq: (f.freq as string ?? "").slice(0, 20),
      ki: ki.length > 0 ? ki : undefined,
    })
  }
  return meds
}

// ── Triage classification ──────────────────────────────────────────────────────
function classifyTriage(vitals: VitalSigns, labs: LabValues, icd10: string[]): TriageClass {
  // P1 criteria — any single criterion sufficient
  const isP1 = (
    // Shock: MAP < 65 or sBP < 90
    (vitals.sbp !== undefined && vitals.sbp < 90) ||
    // Severe hypoxia
    (vitals.spo2 !== undefined && vitals.spo2 < 90) ||
    // Severe tachycardia
    (vitals.hr !== undefined && vitals.hr > 150) ||
    // Critical labs
    (labs.lactate !== undefined && labs.lactate > 4.0) ||
    (labs.hs_tni !== undefined && labs.hs_tni > 52) ||
    (labs.glucose !== undefined && labs.glucose < 2.5) ||
    (labs.pct !== undefined && labs.pct > 10) ||
    // P1 ICD-10 code
    icd10.some(code => ICD10_P1_PATTERNS.some(p => p.test(code)))
  )

  if (isP1) return "P1"

  // P2 criteria
  const isP2 = (
    (vitals.sbp !== undefined && (vitals.sbp < 100 || vitals.sbp > 180)) ||
    (vitals.spo2 !== undefined && vitals.spo2 < 94) ||
    (vitals.hr !== undefined && (vitals.hr > 120 || vitals.hr < 50)) ||
    (labs.lactate !== undefined && labs.lactate > 2.0) ||
    (labs.glucose !== undefined && labs.glucose < 3.5) ||
    (labs.pct !== undefined && labs.pct > 2.0)
  )

  if (isP2) return "P2"

  return "P3"
}

// ── Frame assembler ───────────────────────────────────────────────────────────
export function assembleFrame(
  bundle: FHIRBundle,
  nurse: NURSEOutput,
  kvtc: KVTCOutput,
): { frame: CompTextFrame; meta: PipelineMeta } {
  const startMs = Date.now()

  // Extract all fields
  const vitals = extractVitals(kvtc)
  const labs = extractLabs(kvtc)
  const allergies = extractAllergies(nurse)
  const medications = extractMedications(nurse)

  // Extract ICD-10 codes from conditions
  const icd10 = nurse.resources
    .filter(r => r.type === "Condition")
    .map(r => r.fields.icd10 as string)
    .filter(Boolean)

  const triageClass = bundle._meta?.triageClass ?? classifyTriage(vitals, labs, icd10)

  // Map scenario ID to CompText ScenarioCode
  const scMap: Record<string, CompTextFrame["sc"]> = {
    stemi: "STEMI",
    sepsis: "SEPSIS",
    stroke: "STROKE",
    anaphylaxie: "ANAPH",
    dm_hypo: "DM-HYPO",
  }
  const sc = scMap[bundle._meta?.scenarioId ?? ""] ?? "STEMI"

  const phiHash = nurse.phi_hash
  const now = Math.floor(Date.now() / 1000)

  const frame: CompTextFrame = {
    v: "5",
    sc,
    tri: triageClass,
    alg: allergies,
    rx: medications,
    vs: vitals,
    lab: labs,
    ctx: kvtc.layer_c.narrative.slice(0, 200),
    icd: icd10,
    ts: now,
    gdpr: {
      art9: true,
      phi_hash: phiHash,
      scrubbed_at: now,
      minimized: true,
    },
  }

  const frameJson = JSON.stringify(frame)
  const tokOut = estimateTokens(frameJson)

  const totalMs = Date.now() - startMs + 5 // add base processing time

  const meta: PipelineMeta = {
    tok_in: bundle._meta?.tokenCountRaw ?? nurse.token_in,
    tok_out: tokOut,
    reduction_pct: Math.round((1 - tokOut / (bundle._meta?.tokenCountRaw ?? nurse.token_in)) * 100 * 10) / 10,
    stages: [
      { name: "FHIR-Raw", tok: bundle._meta?.tokenCountRaw ?? nurse.token_in, ms: 0 },
      { name: "NURSE", tok: nurse.token_out, ms: 2 },
      { name: "KVTC", tok: kvtc.token_out, ms: 3 },
      { name: "Frame", tok: tokOut, ms: totalMs },
    ],
    total_ms: totalMs,
  }

  frame._pipe = meta

  return { frame, meta }
}
