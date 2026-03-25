/**
 * @comptext/core — Pipeline Entry Point
 *
 * CompText v5 full pipeline:
 *   FHIR Bundle → NURSE → KVTC → Frame → CompTextFrame
 *
 * @example
 * ```typescript
 * import { pipeline, FHIR_STEMI } from "@comptext/core"
 *
 * const result = await pipeline(FHIR_STEMI)
 * console.log(result.frame)  // CompTextFrame ready for MedGemma
 * console.log(`${result.benchmark.reduction_pct}% token reduction`)
 * ```
 */

import type { FHIRBundle } from "./data.js"
import type { PipelineResult } from "./types/index.js"
import { runNURSE, estimateTokens } from "./compiler/nurse.js"
import { runKVTC } from "./compiler/kvtc.js"
import { assembleFrame } from "./compiler/triage.js"
import { CompTextError } from "./types/index.js"

export { CompTextError } from "./types/index.js"
export type {
  CompTextFrame,
  PipelineResult,
  VitalSigns,
  LabValues,
  AllergyCode,
  MedicationCode,
  TriageClass,
  NURSEOutput,
  KVTCOutput,
} from "./types/index.js"

export {
  ALL_FHIR_BUNDLES,
  FHIR_STEMI,
  FHIR_SEPSIS,
  FHIR_STROKE,
  FHIR_ANAPHYLAXIE,
  FHIR_DM_HYPO,
  TOKEN_BENCHMARKS,
} from "./data.js"

export type { FHIRBundle, FHIRPatient, FHIRObservation, FHIRCondition } from "./data.js"

/**
 * Run the full CompText pipeline on a FHIR R4 bundle.
 *
 * @param bundle - FHIR R4 Bundle (Patient + Observations + Conditions + Medications)
 * @returns PipelineResult with CompTextFrame and benchmark metrics
 * @throws CompTextError if bundle is invalid or processing fails
 */
export async function pipeline(bundle: FHIRBundle): Promise<PipelineResult> {
  // Validate input
  if (!bundle.entry?.length) {
    throw new CompTextError(
      "Bundle has no entries",
      "NO_RESOURCES",
      { bundle_id: bundle.id },
    )
  }

  if (bundle.resourceType !== "Bundle") {
    throw new CompTextError(
      `Expected resourceType 'Bundle', got '${bundle.resourceType}'`,
      "INVALID_FHIR",
    )
  }

  const fhirBytes = JSON.stringify(bundle).length

  // Stage 1: NURSE — PHI scrubbing
  const nurse = runNURSE(bundle)

  if (!nurse.scrubbed) {
    throw new CompTextError("NURSE stage failed to scrub PHI", "PHI_SCRUB_FAILED")
  }

  // Stage 2: KVTC — 4-layer compression
  const kvtc = runKVTC(nurse)

  // Stage 3: Frame assembly + triage
  const { frame, meta } = assembleFrame(bundle, nurse, kvtc)

  return {
    input: {
      bundle_id: bundle.id,
      scenario_id: bundle._meta?.scenarioId ?? "unknown",
      token_count: bundle._meta?.tokenCountRaw ?? nurse.token_in,
      fhir_bytes: fhirBytes,
    },
    nurse,
    kvtc,
    frame,
    benchmark: {
      total_ms: meta.total_ms,
      reduction_pct: meta.reduction_pct,
      gdpr_compliant: frame.gdpr.art9 && frame.gdpr.minimized,
    },
  }
}

/**
 * Run pipeline on all 5 clinical scenarios and return comparison table.
 * Useful for benchmarking and visualization.
 */
export async function pipelineAll(): Promise<Record<string, PipelineResult>> {
  const { ALL_FHIR_BUNDLES } = await import("./data.js")
  const results: Record<string, PipelineResult> = {}
  for (const [id, bundle] of Object.entries(ALL_FHIR_BUNDLES)) {
    results[id] = await pipeline(bundle)
  }
  return results
}

/**
 * Serialize CompTextFrame to compact DSL string (the actual token-efficient format).
 * This is what gets sent to MedGemma.
 */
export function frameToCompText(frame: import("./types/index.js").CompTextFrame): string {
  throw new Error("Import CompTextFrame type, not value")
}

/** Serialize a CompTextFrame to compact DSL notation */
export function serializeFrame(frame: import("./types/index.js").CompTextFrame): string {
  const lines: string[] = []
  lines.push(`CT:v${frame.v} SC:${frame.sc} TRI:${frame.tri}`)

  // Vitals
  const vs = Object.entries(frame.vs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ")
  if (vs) lines.push(`VS[${vs}]`)

  // Labs
  const lab = Object.entries(frame.lab)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ")
  if (lab) lines.push(`LAB[${lab}]`)

  // Allergies — never compressed
  for (const alg of frame.alg) {
    const ki = alg.rx?.join(",") ?? ""
    lines.push(`ALG:${alg.ag} SEV:${alg.sev}${ki ? ` KI:[${ki}]` : ""}`)
  }

  // Medications
  for (const rx of frame.rx) {
    const ki = rx.ki?.join(",") ?? ""
    lines.push(`RX:${rx.name} ATC:${rx.atc} DOSE:${rx.dose} FREQ:${rx.freq}${ki ? ` KI:[${ki}]` : ""}`)
  }

  // ICD-10
  lines.push(`ICD:[${frame.icd.join(",")}]`)

  // Context
  if (frame.ctx) lines.push(`CTX:${frame.ctx}`)

  // GDPR marker
  lines.push(`GDPR:ART9 PHI:${frame.gdpr.phi_hash} TS:${frame.ts}`)

  return lines.join("\n")
}
