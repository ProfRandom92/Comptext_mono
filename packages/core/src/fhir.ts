/**
 * @comptext/core/fhir — FHIR R4 type definitions and clinical test bundles
 *
 * Re-exports all FHIR types and the 5 validated clinical scenarios.
 */

export type {
  FHIRBundle,
  FHIRPatient,
  FHIRObservation,
  FHIRCondition,
  FHIRMedicationStatement,
} from "./data.js"

export {
  FHIR_STEMI,
  FHIR_SEPSIS,
  FHIR_STROKE,
  FHIR_ANAPHYLAXIE,
  FHIR_DM_HYPO,
  ALL_FHIR_BUNDLES,
} from "./data.js"
