/**
 * @comptext/core — KVTC Stage
 * Key-Value-Type-Code compression
 *
 * Four deterministic layers:
 *   K — Key extraction: remove FHIR structural overhead, keep coded values
 *   V — Value normalization: SI units, significant figures, compact notation
 *   T — Type encoding: verbose type strings → CompText codes
 *   C — Context compression: narrative deduplication and abbreviation
 *
 * All layers are deterministic — no LLM, no randomness.
 */

import type { NURSEOutput, KVTCOutput, KLayerOutput, VLayerOutput, TLayerOutput, CLayerOutput } from "../types/index.js"
import { estimateTokens } from "./nurse.js"

// ── LOINC → CompText key mapping (clinical abbreviations) ─────────────────────
const LOINC_TO_KEY: Record<string, string> = {
  "89579-7": "hsTnI",
  "13969-1": "CKMB",
  "2519-7": "LAC",
  "33959-8": "PCT",
  "1988-5": "CRP",
  "15074-8": "BZ",
  "62238-1": "eGFR",
  "55284-4": "BP",
  "8480-6": "sBP",
  "8462-4": "dBP",
  "8867-4": "HR",
  "59408-5": "SpO2",
  "9279-1": "AF",
  "8310-5": "Temp",
  "72107-6": "NIHSS",
}

// ── Unit normalization table ───────────────────────────────────────────────────
// Key: source unit, Value: [target unit, conversion factor, decimal places]
const UNIT_NORMALIZE: Record<string, [string, number, number]> = {
  "ng/L": ["ng/L", 1, 0],
  "µg/L": ["µg/L", 1, 1],
  "ug/L": ["µg/L", 1, 1],
  "mmol/L": ["mmol/L", 1, 1],
  "mg/L": ["mg/L", 1, 0],
  "mm[Hg]": ["mmHg", 1, 0],
  "mmHg": ["mmHg", 1, 0],
  "/min": ["/min", 1, 0],
  "%": ["%", 1, 0],
  "{score}": ["pts", 1, 0],
  "mL/min/{1.73_m2}": ["ml/min/1.73m²", 1, 0],
  "mL/min/1.73m2": ["ml/min/1.73m²", 1, 0],
  "ng": ["ng", 1, 0],
  "mg": ["mg", 1, 0],
}

// ── Interpretation → compact code ─────────────────────────────────────────────
const INTERP_CODE: Record<string, string> = {
  "HH": "↑↑",  // Critical high
  "H": "↑",    // High
  "N": "n",    // Normal
  "L": "↓",    // Low
  "LL": "↓↓",  // Critical low
}

// ── FHIR resource type → compact type code ────────────────────────────────────
const TYPE_ENCODE: Record<string, string> = {
  "Patient": "PAT",
  "Observation": "OBS",
  "Condition": "DX",
  "MedicationStatement": "MED",
  "AllergyIntolerance": "ALG",
  "Procedure": "PROC",
  "DiagnosticReport": "RPT",
}

// ── Clinical abbreviation table ───────────────────────────────────────────────
const CLINICAL_ABBREV: Array<[RegExp, string]> = [
  [/Akuter/gi, "Ak."],
  [/transmuraler/gi, "transm."],
  [/Myokardinfarkt/gi, "MI"],
  [/der Vorderwand/gi, "VW"],
  [/kardiogener Schock/gi, "KS"],
  [/als initial bezeichnet/gi, ""],
  [/nicht näher bezeichnet/gi, "n.n.b."],
  [/Pneumonie/gi, "PNA"],
  [/septischer Schock/gi, "SepS"],
  [/ambulant erworben/gi, "CAP"],
  [/Hirninfarkt/gi, "Stroke"],
  [/zerebraler Arterien/gi, "zer.Art."],
  [/Thrombose/gi, "Thrombose"],
  [/Anaphylaktischer Schock/gi, "AnaphS"],
  [/Diabetes mellitus/gi, "DM"],
  [/Typ 2/gi, "T2"],
  [/Hypoglykämie/gi, "Hypo"],
  [/mit Koma/gi, "+Koma"],
  [/bekannt/gi, "bekannt"],
  [/Eingeschränkte Nierenfunktion/gi, "NI"],
  [/Kontrastmittel-Allergie/gi, "KM-ALG"],
  [/Penicillin-Allergie/gi, "Pen-ALG"],
  [/Wespenstich/gi, "Hymenoptera"],
  [/Insekten-Hymenoptera-Allergie/gi, "Insekt-ALG"],
  [/Asthma bronchiale/gi, "Asthma"],
]

// ── K Layer — Key extraction ──────────────────────────────────────────────────
function runKLayer(nurse: NURSEOutput): KLayerOutput {
  const pairs: KLayerOutput["pairs"] = []
  let tokenSaved = 0

  for (const res of nurse.resources) {
    if (res.type !== "Observation") continue
    const f = res.fields
    const loinc = f.loinc as string | undefined
    const key = loinc ? (LOINC_TO_KEY[loinc] ?? loinc) : (f.display as string ?? "?")

    if (f.value !== undefined) {
      const interp = f.interpretation as string | undefined
      pairs.push({
        loinc: loinc ?? "?",
        display: key,
        value: f.value as number,
        unit: f.unit as string ?? "",
        interp: interp ? INTERP_CODE[interp] : undefined,
      })
      // Token saved: FHIR "valueQuantity":{"value":X,"unit":"Y","system":"...","code":"Y"} → X Y
      tokenSaved += 12
    }
  }

  return { pairs, token_saved: tokenSaved }
}

// ── V Layer — Value normalization ─────────────────────────────────────────────
function runVLayer(kLayer: KLayerOutput): VLayerOutput {
  const normalized: VLayerOutput["normalized"] = []
  let tokenSaved = 0

  for (const pair of kLayer.pairs) {
    const norm = UNIT_NORMALIZE[pair.unit]
    const targetUnit = norm ? norm[0] : pair.unit
    const factor = norm ? norm[1] : 1
    const decimals = norm ? norm[2] : 1

    const value = (pair.value * factor).toFixed(decimals).replace(/\.?0+$/, "")
    const critical = pair.interp === "↑↑" || pair.interp === "↓↓"

    const compact = `${pair.display}:${value}${targetUnit}${pair.interp ? pair.interp : ""}`
    normalized.push({ key: pair.display, compact, critical })

    // Average token saved by removing verbose unit descriptions
    if (pair.unit !== targetUnit) tokenSaved += 3
  }

  return { normalized, token_saved: tokenSaved }
}

// ── T Layer — Type encoding ───────────────────────────────────────────────────
function runTLayer(nurse: NURSEOutput): TLayerOutput {
  const encoded: Record<string, string> = {}
  let tokenSaved = 0

  for (const res of nurse.resources) {
    const code = TYPE_ENCODE[res.type]
    if (code && code !== res.type) {
      encoded[res.type] = code
      tokenSaved += (res.type.length - code.length) / 4 // rough token estimate
    }
  }

  return { encoded, token_saved: Math.round(tokenSaved) }
}

// ── C Layer — Context compression ─────────────────────────────────────────────
function runCLayer(nurse: NURSEOutput): CLayerOutput {
  const condTexts: string[] = []

  for (const res of nurse.resources) {
    if (res.type === "Condition") {
      const text = res.fields.text as string | undefined
      if (text) condTexts.push(text)
    }
  }

  let narrative = condTexts.join("; ")
  const originalLen = narrative.length

  // Apply clinical abbreviations
  for (const [pattern, replacement] of CLINICAL_ABBREV) {
    narrative = narrative.replace(pattern, replacement)
  }

  // Remove double spaces and trailing punctuation artifacts
  narrative = narrative.replace(/\s+/g, " ").replace(/\s*;+\s*/g, "; ").trim()

  const savedChars = originalLen - narrative.length
  const tokenSaved = Math.round(savedChars / 4)

  return { narrative, token_saved: tokenSaved }
}

// ── KVTC Main ─────────────────────────────────────────────────────────────────
export function runKVTC(nurse: NURSEOutput): KVTCOutput {
  const tokenIn = nurse.token_out

  const layer_k = runKLayer(nurse)
  const layer_v = runVLayer(layer_k)
  const layer_t = runTLayer(nurse)
  const layer_c = runCLayer(nurse)

  // Estimate token out: vitals + conditions narrative + overhead
  const vitalTokens = layer_v.normalized.length * 4  // ~4 tokens per vital
  const narrativeTokens = estimateTokens(layer_c.narrative)
  const structureOverhead = 20
  const tokenOut = vitalTokens + narrativeTokens + structureOverhead

  return {
    layer_k,
    layer_v,
    layer_t,
    layer_c,
    token_in: tokenIn,
    token_out: Math.max(tokenOut, 25), // minimum viable context
  }
}
