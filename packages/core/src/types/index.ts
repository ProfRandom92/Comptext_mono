/**
 * @comptext/core — Type Definitions
 *
 * CompText DSL v5 — Domain-Specific Language for clinical AI preprocessing
 *
 * Design principles:
 *  - Deterministic compression (same input → same output, no LLM in pipeline)
 *  - Safety-critical fields NEVER compressed: ALG, RX, TRIAGE, VITAL-CRIT
 *  - GDPR Art. 5/17/25 compliant: PHI hashed before storage, not reversible
 *  - Token reduction target: > 90% vs raw FHIR JSON
 */

// ── Core DSL Types ─────────────────────────────────────────────────────────────

/** CompText Frame — the output format consumed by MedGemma / any LLM */
export interface CompTextFrame {
  /** Schema version */
  v: "5"
  /** Scenario type */
  sc: ScenarioCode
  /** Triage classification */
  tri: TriageClass
  /** Safety-critical alerts — NEVER compressed */
  alg: AllergyCode[]
  rx: MedicationCode[]
  /** Vital signs — critical values use compact notation */
  vs: VitalSigns
  /** Laboratory — key values only */
  lab: LabValues
  /** Clinical context — compressed narrative */
  ctx: string
  /** ICD-10 codes */
  icd: string[]
  /** Timestamp (Unix epoch, seconds) */
  ts: number
  /** GDPR compliance marker */
  gdpr: GDPRMarker
  /** Pipeline metadata */
  _pipe?: PipelineMeta
}

export type ScenarioCode = "STEMI" | "SEPSIS" | "STROKE" | "ANAPH" | "DM-HYPO" | "TRAUMA" | "ACS" | "HF-DECOMP"
export type TriageClass = "P1" | "P2" | "P3" | "P4"

/** Safety-critical allergy codes — always expanded, never abbreviated */
export interface AllergyCode {
  ag: string        // allergen (SNOMED preferred term, max 20 chars)
  sev: "I" | "II" | "III" | "IV"  // WAO/AWMF severity grade
  rx?: string[]     // contraindicated drug classes (ATC codes)
  note?: string     // clinical note (max 60 chars)
}

/** Medication with clinical relevance markers */
export interface MedicationCode {
  atc: string         // ATC code (WHO)
  name: string        // INN, max 20 chars
  dose: string        // compact dose notation "500mg iv"
  freq: string        // compact frequency "1x/d"
  ki?: string[]       // Kontraindikation / clinical alerts
}

/** Vital signs — compact notation */
export interface VitalSigns {
  hr?: number           // bpm
  sbp?: number          // mmHg systolic
  dbp?: number          // mmHg diastolic
  spo2?: number         // % O2 saturation
  rr?: number           // /min respiratory rate
  temp?: number         // °C
  gcs?: number          // 3-15 Glasgow Coma Scale
  map?: number          // mmHg mean arterial pressure
}

/** Laboratory — key values relevant to scenario */
export interface LabValues {
  // Cardiac
  hs_tni?: number       // ng/L hsTroponin I
  ckmb?: number         // µg/L CK-MB
  // Infection/Sepsis
  pct?: number          // µg/L Procalcitonin
  crp?: number          // mg/L CRP
  lactate?: number      // mmol/L
  // Neurology
  glucose?: number      // mmol/L
  // Renal
  egfr?: number         // mL/min/1.73m²
  creatinine?: number   // µmol/L
  // Coagulation
  inr?: number
  aptt?: number         // s
  // Hematology
  hb?: number           // g/dL
  wbc?: number          // 10^9/L
  plt?: number          // 10^9/L
}

export interface GDPRMarker {
  /** Art. 9 DSGVO — special category data processed */
  art9: true
  /** PHI hash (SHA-256 first 8 chars, not reversible) */
  phi_hash: string
  /** PHI scrubbed timestamp */
  scrubbed_at: number
  /** Data minimization applied */
  minimized: true
}

export interface PipelineMeta {
  tok_in: number      // input token count
  tok_out: number     // output token count
  reduction_pct: number
  stages: Array<{ name: string; tok: number; ms: number }>
  total_ms: number
}

// ── NURSE Stage Types ──────────────────────────────────────────────────────────

/** Output of NURSE (PHI scrubbing + deduplication) stage */
export interface NURSEOutput {
  bundle_id: string
  scrubbed: boolean
  phi_hash: string
  phi_fields_removed: number
  token_in: number
  token_out: number
  resources: NURSEResource[]
}

export interface NURSEResource {
  type: string
  id_hash: string     // original ID hashed
  fields: Record<string, unknown>
}

// ── KVTC Stage Types ──────────────────────────────────────────────────────────

/** KVTC compression layers */
export type KVTCLayer = "K" | "V" | "T" | "C"

/** Output of KVTC (Key-Value-Type-Code compression) stage */
export interface KVTCOutput {
  layer_k: KLayerOutput   // Key extraction
  layer_v: VLayerOutput   // Value normalization
  layer_t: TLayerOutput   // Type encoding
  layer_c: CLayerOutput   // Context compression
  token_in: number
  token_out: number
}

export interface KLayerOutput {
  /** Extracted key-value pairs from FHIR observation resources */
  pairs: Array<{ loinc: string; display: string; value: number; unit: string; interp?: string }>
  token_saved: number
}

export interface VLayerOutput {
  /** Normalized values to SI units and compact notation */
  normalized: Array<{ key: string; compact: string; critical: boolean }>
  token_saved: number
}

export interface TLayerOutput {
  /** Type encoding: verbose FHIR types → CompText codes */
  encoded: Record<string, string>
  token_saved: number
}

export interface CLayerOutput {
  /** Compressed context narrative */
  narrative: string
  token_saved: number
}

// ── Pipeline Result ────────────────────────────────────────────────────────────

export interface PipelineResult {
  input: {
    bundle_id: string
    scenario_id: string
    token_count: number
    fhir_bytes: number
  }
  nurse: NURSEOutput
  kvtc: KVTCOutput
  frame: CompTextFrame
  benchmark: {
    total_ms: number
    reduction_pct: number
    gdpr_compliant: boolean
  }
}

// ── Error Types ───────────────────────────────────────────────────────────────

export class CompTextError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_FHIR" | "PHI_SCRUB_FAILED" | "KVTC_ERROR" | "TRIAGE_UNKNOWN" | "NO_RESOURCES",
    public readonly context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "CompTextError"
  }
}
