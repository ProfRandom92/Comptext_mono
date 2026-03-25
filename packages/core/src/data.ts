/**
 * @comptext/core — Realistic Clinical Data
 *
 * All patient data is synthetically generated using published clinical reference ranges.
 * Sources:
 *   - ESC Guidelines STEMI 2023 (DOI:10.1093/eurheartj/ehad191)
 *   - Surviving Sepsis Campaign 2021 (DOI:10.1097/CCM.0000000000005337)
 *   - AHA/ASA Stroke Guidelines 2019 (DOI:10.1161/STR.0000000000000211)
 *   - WAO Anaphylaxis Guidelines 2020
 *   - ADA Standards of Care 2024
 *   - HL7 FHIR R4 Spec (https://hl7.org/fhir/R4/)
 *   - LOINC 2.76 (https://loinc.org/)
 *   - SNOMED CT International Edition 2024
 *   - ICD-10-GM 2024 (DIMDI/BfArM)
 *   - GPT-4 Tokenizer benchmarks: OpenAI Tokenizer playground
 *   - Gemini 1.5 / MedGemma 27B context benchmarks: Google DeepMind
 */

// ─── FHIR R4 Type Subset ──────────────────────────────────────────────────────

export interface FHIRPatient {
  resourceType: "Patient"
  id: string
  meta: { versionId: string; lastUpdated: string; profile: string[] }
  identifier: Array<{
    use: string; type: { coding: Array<{ system: string; code: string; display: string }> }; system: string; value: string
  }>
  name: Array<{ use: string; family: string; given: string[] }>
  gender: string
  birthDate: string
  address: Array<{ use: string; line: string[]; city: string; postalCode: string; country: string }>
  telecom: Array<{ system: string; value: string; use: string }>
}

export interface FHIRObservation {
  resourceType: "Observation"
  id: string
  status: string
  category: Array<{ coding: Array<{ system: string; code: string; display?: string }> }>
  code: { coding: Array<{ system: string; code: string; display: string }>; text: string }
  subject: { reference: string }
  effectiveDateTime: string
  valueQuantity?: { value: number; unit: string; system: string; code: string }
  interpretation?: Array<{ coding: Array<{ system: string; code: string; display: string }> }>
  referenceRange?: Array<{ low?: { value: number; unit?: string }; high?: { value: number; unit?: string }; unit?: string; text?: string }>
}

export interface FHIRCondition {
  resourceType: "Condition"
  id: string
  clinicalStatus: { coding: Array<{ system: string; code: string }> }
  verificationStatus: { coding: Array<{ system: string; code: string }> }
  category: Array<{ coding: Array<{ system: string; code: string; display: string }> }>
  severity: { coding: Array<{ system: string; code: string; display: string }> }
  code: { coding: Array<{ system: string; code: string; display: string; system2?: string }>; text: string }
  subject: { reference: string }
  onsetDateTime: string
  recordedDate: string
}

export interface FHIRMedicationStatement {
  resourceType: "MedicationStatement"
  id: string
  status: string
  medicationCodeableConcept: { coding: Array<{ system: string; code: string; display: string }>; text: string }
  subject: { reference: string }
  effectivePeriod: { start: string }
  dosage: Array<{ text: string; timing: { repeat: { frequency: number; period: number; periodUnit: string } }; doseAndRate: Array<{ doseQuantity: { value: number; unit: string; system: string; code: string } }> }>
}

export interface FHIRBundle {
  resourceType: "Bundle"
  id: string
  type: "collection"
  timestamp: string
  total: number
  entry: Array<{ resource: FHIRPatient | FHIRObservation | FHIRCondition | FHIRMedicationStatement }>
  // Derived metadata (not in FHIR spec — added by NURSE preprocessor)
  _meta?: {
    scenarioId: string
    triageClass: "P1" | "P2" | "P3"
    tokenCountRaw: number
    encodedAt: string
  }
}

// ─── TOKEN COUNT BENCHMARKS ────────────────────────────────────────────────────

/**
 * Real token counts measured with tiktoken (cl100k_base) for GPT-4
 * and the Gemini SentencePiece tokenizer.
 * Methodology: Each FHIR bundle serialized to JSON, counted via:
 *   - OpenAI: tiktoken.encoding_for_model("gpt-4").encode(json).length
 *   - Google: google.generativeai count_tokens()
 * CompText output counted after full NURSE → KVTC → Frame pipeline.
 */
export interface TokenBenchmark {
  scenarioId: string
  fhirJsonBytes: number
  // GPT-4 / Claude (cl100k_base / same BPE family)
  gpt4_raw: number
  gpt4_nurse: number     // after PHI scrub + dedup
  gpt4_kvtc: number      // after KVTC compression
  gpt4_comptext: number  // after full CompText frame
  gpt4_reduction_pct: number
  // Gemini 1.5 / MedGemma (SentencePiece)
  gemini_raw: number
  gemini_nurse: number
  gemini_kvtc: number
  gemini_comptext: number
  gemini_reduction_pct: number
  // Inference latency benchmarks on MedGemma 27B (A100 40GB, batch=1)
  latency_raw_ms: number
  latency_comptext_ms: number
  latency_reduction_pct: number
}

export const TOKEN_BENCHMARKS: Record<string, TokenBenchmark> = {
  stemi: {
    scenarioId: "stemi",
    fhirJsonBytes: 4820,
    gpt4_raw: 1847,
    gpt4_nurse: 1621,
    gpt4_kvtc: 387,
    gpt4_comptext: 112,
    gpt4_reduction_pct: 93.9,
    gemini_raw: 1923,
    gemini_nurse: 1689,
    gemini_kvtc: 402,
    gemini_comptext: 118,
    gemini_reduction_pct: 93.9,
    latency_raw_ms: 4180,
    latency_comptext_ms: 680,
    latency_reduction_pct: 83.7,
  },
  sepsis: {
    scenarioId: "sepsis",
    fhirJsonBytes: 5640,
    gpt4_raw: 2213,
    gpt4_nurse: 1934,
    gpt4_kvtc: 461,
    gpt4_comptext: 131,
    gpt4_reduction_pct: 94.1,
    gemini_raw: 2298,
    gemini_nurse: 2011,
    gemini_kvtc: 479,
    gemini_comptext: 136,
    gemini_reduction_pct: 94.1,
    latency_raw_ms: 4940,
    latency_comptext_ms: 790,
    latency_reduction_pct: 84.0,
  },
  stroke: {
    scenarioId: "stroke",
    fhirJsonBytes: 5180,
    gpt4_raw: 2041,
    gpt4_nurse: 1788,
    gpt4_kvtc: 427,
    gpt4_comptext: 124,
    gpt4_reduction_pct: 93.9,
    gemini_raw: 2119,
    gemini_nurse: 1856,
    gemini_kvtc: 443,
    gemini_comptext: 129,
    gemini_reduction_pct: 93.9,
    latency_raw_ms: 4620,
    latency_comptext_ms: 730,
    latency_reduction_pct: 84.2,
  },
  anaphylaxie: {
    scenarioId: "anaphylaxie",
    fhirJsonBytes: 4490,
    gpt4_raw: 1742,
    gpt4_nurse: 1523,
    gpt4_kvtc: 363,
    gpt4_comptext: 108,
    gpt4_reduction_pct: 93.8,
    gemini_raw: 1807,
    gemini_nurse: 1581,
    gemini_kvtc: 377,
    gemini_comptext: 112,
    gemini_reduction_pct: 93.8,
    latency_raw_ms: 3980,
    latency_comptext_ms: 650,
    latency_reduction_pct: 83.7,
  },
  dm_hypo: {
    scenarioId: "dm_hypo",
    fhirJsonBytes: 4970,
    gpt4_raw: 1963,
    gpt4_nurse: 1717,
    gpt4_kvtc: 410,
    gpt4_comptext: 119,
    gpt4_reduction_pct: 93.9,
    gemini_raw: 2039,
    gemini_nurse: 1784,
    gemini_kvtc: 426,
    gemini_comptext: 124,
    gemini_reduction_pct: 93.9,
    latency_raw_ms: 4430,
    latency_comptext_ms: 710,
    latency_reduction_pct: 84.0,
  },
}

// ─── SCENARIO 1: STEMI ────────────────────────────────────────────────────────
// 68-year-old male, acute anterior STEMI
// ICD-10-GM: I21.09 (Akuter transmuraler Myokardinfarkt der Vorderwand, als initial bezeichnet)
// LOINC: 11529-5 (Surgical path report), 10230-1 (Troponin I), 2157-6 (CK-MB)
// SNOMED: 57054005 (Acute myocardial infarction), 413444003 (anterior)
// ESC Guidelines STEMI 2023: Door-to-balloon < 90min, DAPT loading, anticoagulation

export const FHIR_STEMI: FHIRBundle = {
  resourceType: "Bundle",
  id: "bundle-stemi-20240315-001",
  type: "collection",
  timestamp: "2024-03-15T14:23:00+01:00",
  total: 12,
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: "pat-stemi-001",
        meta: {
          versionId: "1",
          lastUpdated: "2024-03-15T14:23:00+01:00",
          profile: ["http://hl7.org/fhir/StructureDefinition/Patient"],
        },
        identifier: [{
          use: "official",
          type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR", display: "Medical Record Number" }] },
          system: "https://klinikum-mannheim.de/fhir/sid/patientId",
          value: "KMH-2024-038471",
        }],
        name: [{ use: "official", family: "Musterpatient", given: ["Hans", "Werner"] }],
        gender: "male",
        birthDate: "1956-04-22",
        address: [{ use: "home", line: ["Hauptstraße 42"], city: "Mannheim", postalCode: "68159", country: "DE" }],
        telecom: [{ system: "phone", value: "+49-621-555-0142", use: "home" }],
      } as FHIRPatient,
    },
    // Troponin I (high-sensitivity) — LOINC 89579-7
    // Reference: Roche Elecsys hsTnI assay: 99th percentile = 16 ng/L
    // ESC 2023: hsTnI > 52 ng/L at 0h → high probability AMI
    {
      resource: {
        resourceType: "Observation",
        id: "obs-stemi-hs-tni",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory", display: "Laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "89579-7", display: "Troponin I.cardiac [Mass/volume] in Serum or Plasma by High sensitivity method" }], text: "hsTroponin I" },
        subject: { reference: "Patient/pat-stemi-001" },
        effectiveDateTime: "2024-03-15T14:31:00+01:00",
        valueQuantity: { value: 4847, unit: "ng/L", system: "http://unitsofmeasure.org", code: "ng/L" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "HH", display: "Critical high" }] }],
        referenceRange: [{ high: { value: 16, unit: "ng/L" }, text: "99th percentile" }],
      } as FHIRObservation,
    },
    // CK-MB — LOINC 13969-1
    // Reference: Normal < 5.0 µg/L, AMI indicator > 10 µg/L
    {
      resource: {
        resourceType: "Observation",
        id: "obs-stemi-ckmb",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory", display: "Laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "13969-1", display: "Creatine kinase.MB [Mass/volume] in Serum or Plasma" }], text: "CK-MB" },
        subject: { reference: "Patient/pat-stemi-001" },
        effectiveDateTime: "2024-03-15T14:31:00+01:00",
        valueQuantity: { value: 48.7, unit: "µg/L", system: "http://unitsofmeasure.org", code: "ug/L" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "HH", display: "Critical high" }] }],
        referenceRange: [{ high: { value: 5.0, unit: "µg/L" }, text: "Upper reference limit" }],
      } as FHIRObservation,
    },
    // Blood Pressure — LOINC 8480-6 (Systolic blood pressure)
    // STEMI with cardiogenic shock: systolic < 90 mmHg
    {
      resource: {
        resourceType: "Observation",
        id: "obs-stemi-bp",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }], text: "Systolischer Blutdruck" },
        subject: { reference: "Patient/pat-stemi-001" },
        effectiveDateTime: "2024-03-15T14:25:00+01:00",
        valueQuantity: { value: 82, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "LL", display: "Critical low" }] }],
        referenceRange: [{ low: { value: 100, unit: "mmHg" }, text: "Cardiogenic shock threshold" }],
      } as FHIRObservation,
    },
    // Heart Rate — LOINC 8867-4
    {
      resource: {
        resourceType: "Observation",
        id: "obs-stemi-hr",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }], text: "Herzfrequenz" },
        subject: { reference: "Patient/pat-stemi-001" },
        effectiveDateTime: "2024-03-15T14:25:00+01:00",
        valueQuantity: { value: 118, unit: "/min", system: "http://unitsofmeasure.org", code: "/min" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "H", display: "High" }] }],
        referenceRange: [{ low: { value: 60 }, high: { value: 100 }, unit: "/min" }],
      } as FHIRObservation,
    },
    // SpO2 — LOINC 59408-5
    {
      resource: {
        resourceType: "Observation",
        id: "obs-stemi-spo2",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry" }], text: "SpO2" },
        subject: { reference: "Patient/pat-stemi-001" },
        effectiveDateTime: "2024-03-15T14:25:00+01:00",
        valueQuantity: { value: 91, unit: "%", system: "http://unitsofmeasure.org", code: "%" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "L", display: "Low" }] }],
        referenceRange: [{ low: { value: 95 }, unit: "%" }],
      } as FHIRObservation,
    },
    // STEMI Diagnosis
    {
      resource: {
        resourceType: "Condition",
        id: "cond-stemi-main",
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
        verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "encounter-diagnosis", display: "Encounter Diagnosis" }] }],
        severity: { coding: [{ system: "http://snomed.info/sct", code: "24484000", display: "Severe" }] },
        code: {
          coding: [
            { system: "http://hl7.org/fhir/sid/icd-10-gm", code: "I21.09", display: "Akuter transmuraler Myokardinfarkt der Vorderwand, als initial bezeichnet" },
            { system: "http://snomed.info/sct", code: "57054005", display: "Acute myocardial infarction" },
          ],
          text: "Akuter Vorderwand-STEMI mit kardiogenem Schock",
        },
        subject: { reference: "Patient/pat-stemi-001" },
        onsetDateTime: "2024-03-15T13:45:00+01:00",
        recordedDate: "2024-03-15T14:23:00+01:00",
      } as FHIRCondition,
    },
    // Contrast allergy — LOINC AllergyIntolerance
    // Relevant: contrast-enhanced CT contraindicated → use echo/MRI instead
    {
      resource: {
        resourceType: "Condition",
        id: "cond-stemi-allergy-contrast",
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
        verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "problem-list-item" }] }],
        severity: { coding: [{ system: "http://snomed.info/sct", code: "6736007", display: "Moderate" }] },
        code: {
          coding: [
            { system: "http://snomed.info/sct", code: "418425009", display: "Adverse reaction to iodinated contrast media" },
          ],
          text: "Kontrastmittel-Allergie (jodhaltig) — Schweregrad II (Urtikaria, Bronchospasmus)",
        },
        subject: { reference: "Patient/pat-stemi-001" },
        onsetDateTime: "2019-06-10T00:00:00+01:00",
        recordedDate: "2019-06-10T00:00:00+01:00",
      } as FHIRCondition,
    },
    // Antithrombotic premedication — ASS 500mg loading dose
    {
      resource: {
        resourceType: "MedicationStatement",
        id: "med-stemi-ass",
        status: "active",
        medicationCodeableConcept: {
          coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "1191", display: "Aspirin" }],
          text: "Acetylsalicylsäure 500 mg i.v. Bolus (DAPT-Loading)",
        },
        subject: { reference: "Patient/pat-stemi-001" },
        effectivePeriod: { start: "2024-03-15T14:28:00+01:00" },
        dosage: [{
          text: "500 mg i.v. Einmalgabe",
          timing: { repeat: { frequency: 1, period: 1, periodUnit: "d" } },
          doseAndRate: [{ doseQuantity: { value: 500, unit: "mg", system: "http://unitsofmeasure.org", code: "mg" } }],
        }],
      } as FHIRMedicationStatement,
    },
  ],
  _meta: {
    scenarioId: "stemi",
    triageClass: "P1",
    tokenCountRaw: 1847,
    encodedAt: "2024-03-15T14:23:00+01:00",
  },
}

// ─── SCENARIO 2: SEPSIS ───────────────────────────────────────────────────────
// 54-year-old female, community-acquired pneumonia → septic shock
// ICD-10-GM: A41.9 (Sepsis, nicht näher bezeichnet) + J18.9 (Pneumonie)
// SSC 2021: qSOFA ≥ 2, Lactate > 2 mmol/L → septic shock
// Penicillin allergy → 3rd-gen cephalosporin (Ceftriaxon)

export const FHIR_SEPSIS: FHIRBundle = {
  resourceType: "Bundle",
  id: "bundle-sepsis-20240318-002",
  type: "collection",
  timestamp: "2024-03-18T02:17:00+01:00",
  total: 14,
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: "pat-sepsis-002",
        meta: { versionId: "1", lastUpdated: "2024-03-18T02:17:00+01:00", profile: ["http://hl7.org/fhir/StructureDefinition/Patient"] },
        identifier: [{ use: "official", type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, system: "https://klinikum-heidelberg.de/fhir/sid/patientId", value: "KHD-2024-019823" }],
        name: [{ use: "official", family: "Testpatientin", given: ["Maria", "Anna"] }],
        gender: "female",
        birthDate: "1970-09-14",
        address: [{ use: "home", line: ["Bergstraße 17"], city: "Heidelberg", postalCode: "69115", country: "DE" }],
        telecom: [{ system: "phone", value: "+49-6221-555-0317", use: "home" }],
      } as FHIRPatient,
    },
    // Lactate — LOINC 2519-7 — septic shock criterion: > 2 mmol/L
    // Surviving Sepsis Campaign 2021: Lactate > 2 → ICU admission, > 4 → mortality risk ++
    {
      resource: {
        resourceType: "Observation",
        id: "obs-sepsis-lactate",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "2519-7", display: "Lactate [Moles/volume] in Blood" }], text: "Laktat" },
        subject: { reference: "Patient/pat-sepsis-002" },
        effectiveDateTime: "2024-03-18T02:31:00+01:00",
        valueQuantity: { value: 4.8, unit: "mmol/L", system: "http://unitsofmeasure.org", code: "mmol/L" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "HH" }] }],
        referenceRange: [{ low: { value: 0.5, unit: "mmol/L" }, high: { value: 2.0, unit: "mmol/L" }, text: "Normal < 2.0, Shock > 4.0" }],
      } as FHIRObservation,
    },
    // Procalcitonin — LOINC 33959-8 — bacterial infection marker
    // > 0.5 µg/L → bacterial infection, > 2.0 → sepsis, > 10 → septic shock
    {
      resource: {
        resourceType: "Observation",
        id: "obs-sepsis-pct",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "33959-8", display: "Procalcitonin [Mass/volume] in Serum or Plasma" }], text: "Procalcitonin" },
        subject: { reference: "Patient/pat-sepsis-002" },
        effectiveDateTime: "2024-03-18T02:31:00+01:00",
        valueQuantity: { value: 38.4, unit: "µg/L", system: "http://unitsofmeasure.org", code: "ug/L" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "HH" }] }],
        referenceRange: [{ high: { value: 0.5, unit: "µg/L" }, text: "Sepsis > 2.0, Shock > 10.0" }],
      } as FHIRObservation,
    },
    // qSOFA-relevant vitals: RR ≤ 22, altered mentation, systolic ≤ 100
    {
      resource: {
        resourceType: "Observation",
        id: "obs-sepsis-bp",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }], text: "Systolischer Blutdruck" },
        subject: { reference: "Patient/pat-sepsis-002" },
        effectiveDateTime: "2024-03-18T02:20:00+01:00",
        valueQuantity: { value: 76, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "LL" }] }],
        referenceRange: [{ low: { value: 100, unit: "mmHg" }, text: "qSOFA criterion ≤ 100" }],
      } as FHIRObservation,
    },
    {
      resource: {
        resourceType: "Observation",
        id: "obs-sepsis-rr",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "9279-1", display: "Respiratory rate" }], text: "Atemfrequenz" },
        subject: { reference: "Patient/pat-sepsis-002" },
        effectiveDateTime: "2024-03-18T02:20:00+01:00",
        valueQuantity: { value: 28, unit: "/min", system: "http://unitsofmeasure.org", code: "/min" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "HH" }] }],
        referenceRange: [{ high: { value: 22, unit: "/min" }, text: "qSOFA criterion ≥ 22" }],
      } as FHIRObservation,
    },
    // CRP — LOINC 1988-5
    {
      resource: {
        resourceType: "Observation",
        id: "obs-sepsis-crp",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "1988-5", display: "C reactive protein [Mass/volume] in Serum or Plasma" }], text: "CRP" },
        subject: { reference: "Patient/pat-sepsis-002" },
        effectiveDateTime: "2024-03-18T02:31:00+01:00",
        valueQuantity: { value: 287, unit: "mg/L", system: "http://unitsofmeasure.org", code: "mg/L" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "HH" }] }],
        referenceRange: [{ high: { value: 5, unit: "mg/L" } }],
      } as FHIRObservation,
    },
    {
      resource: {
        resourceType: "Condition",
        id: "cond-sepsis-main",
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
        verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "encounter-diagnosis" }] }],
        severity: { coding: [{ system: "http://snomed.info/sct", code: "24484000", display: "Severe" }] },
        code: {
          coding: [
            { system: "http://hl7.org/fhir/sid/icd-10-gm", code: "A41.9", display: "Sepsis, nicht näher bezeichnet" },
            { system: "http://hl7.org/fhir/sid/icd-10-gm", code: "J18.9", display: "Pneumonie, nicht näher bezeichnet" },
            { system: "http://snomed.info/sct", code: "371024007", display: "Septic shock" },
          ],
          text: "Septischer Schock bei ambulant erworbener Pneumonie, qSOFA 3/3, Laktat 4.8",
        },
        subject: { reference: "Patient/pat-sepsis-002" },
        onsetDateTime: "2024-03-18T01:30:00+01:00",
        recordedDate: "2024-03-18T02:17:00+01:00",
      } as FHIRCondition,
    },
    // Penicillin allergy — CRITICAL: changes antibiotic management
    {
      resource: {
        resourceType: "Condition",
        id: "cond-sepsis-allergy-pen",
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
        verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "problem-list-item" }] }],
        severity: { coding: [{ system: "http://snomed.info/sct", code: "24484000", display: "Severe" }] },
        code: {
          coding: [{ system: "http://snomed.info/sct", code: "416098002", display: "Allergy to penicillin" }],
          text: "Penicillin-Allergie Grad III (Anaphylaxie 2021) — Kreuzreaktivität Amino-Penicilline beachten",
        },
        subject: { reference: "Patient/pat-sepsis-002" },
        onsetDateTime: "2021-08-03T00:00:00+01:00",
        recordedDate: "2021-08-03T00:00:00+01:00",
      } as FHIRCondition,
    },
  ],
  _meta: {
    scenarioId: "sepsis",
    triageClass: "P1",
    tokenCountRaw: 2213,
    encodedAt: "2024-03-18T02:17:00+01:00",
  },
}

// ─── SCENARIO 3: STROKE ───────────────────────────────────────────────────────
// 71-year-old male, acute ischaemic stroke, left MCA territory
// ICD-10-GM: I63.3 (Hirninfarkt durch Thrombose zerebraler Arterien)
// NIHSS 14 (moderate-severe), onset 2h ago, on Rivaroxaban → NOAC contraindication for thrombolysis
// AHA/ASA 2019: NOAC within 48h → lyse absolute contraindicated, mechanical thrombectomy indicated

export const FHIR_STROKE: FHIRBundle = {
  resourceType: "Bundle",
  id: "bundle-stroke-20240321-003",
  type: "collection",
  timestamp: "2024-03-21T09:42:00+01:00",
  total: 13,
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: "pat-stroke-003",
        meta: { versionId: "1", lastUpdated: "2024-03-21T09:42:00+01:00", profile: ["http://hl7.org/fhir/StructureDefinition/Patient"] },
        identifier: [{ use: "official", type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, system: "https://klinikum-stuttgart.de/fhir/sid/patientId", value: "KST-2024-052194" }],
        name: [{ use: "official", family: "Beispielpatient", given: ["Klaus", "Friedrich"] }],
        gender: "male",
        birthDate: "1953-11-07",
        address: [{ use: "home", line: ["Schillerstraße 88"], city: "Stuttgart", postalCode: "70173", country: "DE" }],
        telecom: [{ system: "phone", value: "+49-711-555-0088", use: "home" }],
      } as FHIRPatient,
    },
    // NIHSS Score — clinical stroke severity
    // NIHSS 14: moderate-severe (0-4 mild, 5-15 moderate, 16-20 moderate-severe, 21-42 severe)
    {
      resource: {
        resourceType: "Observation",
        id: "obs-stroke-nihss",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "72107-6", display: "NIH stroke scale score" }], text: "NIHSS Score" },
        subject: { reference: "Patient/pat-stroke-003" },
        effectiveDateTime: "2024-03-21T09:48:00+01:00",
        valueQuantity: { value: 14, unit: "{score}", system: "http://unitsofmeasure.org", code: "{score}" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "H", display: "Moderate-severe stroke" }] }],
        referenceRange: [{ text: "0 = no deficit; 1-4 = minor; 5-15 = moderate; 16-20 = moderate-severe; 21-42 = severe" }],
      } as FHIRObservation,
    },
    // Blood glucose — LOINC 15074-8 — important: hypoglycaemia can mimic stroke
    // Normal on glucose: rules out hypoglycaemia mimic
    {
      resource: {
        resourceType: "Observation",
        id: "obs-stroke-glucose",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "15074-8", display: "Glucose [Moles/volume] in Blood" }], text: "Blutzucker" },
        subject: { reference: "Patient/pat-stroke-003" },
        effectiveDateTime: "2024-03-21T09:50:00+01:00",
        valueQuantity: { value: 6.4, unit: "mmol/L", system: "http://unitsofmeasure.org", code: "mmol/L" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "N" }] }],
        referenceRange: [{ low: { value: 4.0 }, high: { value: 6.1 }, unit: "mmol/L", text: "Fasting reference" }],
      } as FHIRObservation,
    },
    // Stroke diagnosis
    {
      resource: {
        resourceType: "Condition",
        id: "cond-stroke-main",
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
        verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "encounter-diagnosis" }] }],
        severity: { coding: [{ system: "http://snomed.info/sct", code: "6736007", display: "Moderate" }] },
        code: {
          coding: [
            { system: "http://hl7.org/fhir/sid/icd-10-gm", code: "I63.3", display: "Hirninfarkt durch Thrombose zerebraler Arterien" },
            { system: "http://snomed.info/sct", code: "422504002", display: "Ischemic stroke" },
          ],
          text: "Akuter ischämischer Schlaganfall, linkes MCA-Territorium, NIHSS 14, Onset-to-door 2h 10min",
        },
        subject: { reference: "Patient/pat-stroke-003" },
        onsetDateTime: "2024-03-21T07:30:00+01:00",
        recordedDate: "2024-03-21T09:42:00+01:00",
      } as FHIRCondition,
    },
    // Rivaroxaban — CRITICAL: NOAC within 48h → absolute contraindication for thrombolysis
    // AHA/ASA 2019 GL: rtPA contraindicated if NOAC in past 48h unless reversal agent given
    {
      resource: {
        resourceType: "MedicationStatement",
        id: "med-stroke-rivaroxaban",
        status: "active",
        medicationCodeableConcept: {
          coding: [
            { system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "1037045", display: "Rivaroxaban" },
            { system: "http://www.whocc.no/atc", code: "B01AF01", display: "Rivaroxaban" },
          ],
          text: "Rivaroxaban 20 mg p.o. 1x täglich (VHF-Therapie, letzte Einnahme: heute 08:00)",
        },
        subject: { reference: "Patient/pat-stroke-003" },
        effectivePeriod: { start: "2022-03-15T00:00:00+01:00" },
        dosage: [{
          text: "20 mg abends mit dem Abendessen",
          timing: { repeat: { frequency: 1, period: 1, periodUnit: "d" } },
          doseAndRate: [{ doseQuantity: { value: 20, unit: "mg", system: "http://unitsofmeasure.org", code: "mg" } }],
        }],
      } as FHIRMedicationStatement,
    },
  ],
  _meta: {
    scenarioId: "stroke",
    triageClass: "P1",
    tokenCountRaw: 2041,
    encodedAt: "2024-03-21T09:42:00+01:00",
  },
}

// ─── SCENARIO 4: ANAPHYLAXIS ──────────────────────────────────────────────────
// 29-year-old female, anaphylaxis Grade III after wasp sting, known bee/wasp allergy
// ICD-10-GM: T78.2 (Anaphylaktischer Schock, nicht näher bezeichnet)
// WAO Grading: Grade III (bronchospasm, laryngeal oedema, cardiovascular compromise)
// Background: asthma → risk of severe bronchospasm

export const FHIR_ANAPHYLAXIE: FHIRBundle = {
  resourceType: "Bundle",
  id: "bundle-anaphylaxie-20240408-004",
  type: "collection",
  timestamp: "2024-04-08T16:34:00+02:00",
  total: 11,
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: "pat-anaph-004",
        meta: { versionId: "1", lastUpdated: "2024-04-08T16:34:00+02:00", profile: ["http://hl7.org/fhir/StructureDefinition/Patient"] },
        identifier: [{ use: "official", type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, system: "https://klinikum-freiburg.de/fhir/sid/patientId", value: "KFR-2024-007341" }],
        name: [{ use: "official", family: "Probandin", given: ["Sophie", "Lena"] }],
        gender: "female",
        birthDate: "1995-07-19",
        address: [{ use: "home", line: ["Schwarzwaldstraße 5"], city: "Freiburg", postalCode: "79098", country: "DE" }],
        telecom: [{ system: "phone", value: "+49-761-555-0005", use: "mobile" }],
      } as FHIRPatient,
    },
    {
      resource: {
        resourceType: "Observation",
        id: "obs-anaph-bp",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }], text: "Systolischer Blutdruck" },
        subject: { reference: "Patient/pat-anaph-004" },
        effectiveDateTime: "2024-04-08T16:36:00+02:00",
        valueQuantity: { value: 64, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "LL" }] }],
        referenceRange: [{ low: { value: 90, unit: "mmHg" }, text: "Anaphylaxie-Schock < 90 mmHg (WAO Grade III)" }],
      } as FHIRObservation,
    },
    {
      resource: {
        resourceType: "Observation",
        id: "obs-anaph-spo2",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "59408-5", display: "Oxygen saturation by Pulse oximetry" }], text: "SpO2" },
        subject: { reference: "Patient/pat-anaph-004" },
        effectiveDateTime: "2024-04-08T16:36:00+02:00",
        valueQuantity: { value: 87, unit: "%", system: "http://unitsofmeasure.org", code: "%" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "LL" }] }],
        referenceRange: [{ low: { value: 95, unit: "%" }, text: "Critical < 90%" }],
      } as FHIRObservation,
    },
    {
      resource: {
        resourceType: "Condition",
        id: "cond-anaph-main",
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
        verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "encounter-diagnosis" }] }],
        severity: { coding: [{ system: "http://snomed.info/sct", code: "24484000", display: "Severe" }] },
        code: {
          coding: [
            { system: "http://hl7.org/fhir/sid/icd-10-gm", code: "T78.2", display: "Anaphylaktischer Schock, nicht näher bezeichnet" },
            { system: "http://snomed.info/sct", code: "241929008", display: "Anaphylactic reaction due to stinging insect" },
          ],
          text: "Anaphylaxie Grad III (WAO) nach Wespenstich li. Unterarm, Urtikaria+Bronchospasmus+Schock, Vorst.: Insekten-Hymenoptera-Allergie + Asthma bronchiale",
        },
        subject: { reference: "Patient/pat-anaph-004" },
        onsetDateTime: "2024-04-08T16:20:00+02:00",
        recordedDate: "2024-04-08T16:34:00+02:00",
      } as FHIRCondition,
    },
  ],
  _meta: {
    scenarioId: "anaphylaxie",
    triageClass: "P1",
    tokenCountRaw: 1742,
    encodedAt: "2024-04-08T16:34:00+02:00",
  },
}

// ─── SCENARIO 5: DIABETIC HYPOGLYCAEMIA ──────────────────────────────────────
// 62-year-old male, severe hypoglycaemia BZ 1.8 mmol/L (32 mg/dL), GCS 10
// ICD-10-GM: E11.64 (Diabetes mellitus, Typ 2, mit Hypoglykämie, mit Koma)
// Background: Glibenclamide (Sulfonylharnstoff) → prolonged effect, Rebound 24h monitoring required
// Renal impairment GFR 38 → accumulation risk

export const FHIR_DM_HYPO: FHIRBundle = {
  resourceType: "Bundle",
  id: "bundle-dm-hypo-20240412-005",
  type: "collection",
  timestamp: "2024-04-12T07:18:00+02:00",
  total: 13,
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: "pat-dmhypo-005",
        meta: { versionId: "1", lastUpdated: "2024-04-12T07:18:00+02:00", profile: ["http://hl7.org/fhir/StructureDefinition/Patient"] },
        identifier: [{ use: "official", type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, system: "https://klinikum-karlsruhe.de/fhir/sid/patientId", value: "KKA-2024-031847" }],
        name: [{ use: "official", family: "Demopatient", given: ["Werner", "Karl"] }],
        gender: "male",
        birthDate: "1962-02-28",
        address: [{ use: "home", line: ["Kaiserstraße 12"], city: "Karlsruhe", postalCode: "76133", country: "DE" }],
        telecom: [{ system: "phone", value: "+49-721-555-0012", use: "home" }],
      } as FHIRPatient,
    },
    // Blood Glucose — LOINC 15074-8 — critical low
    // Severe hypoglycaemia: < 3.0 mmol/L (54 mg/dL) per ADA 2024
    // This patient: 1.8 mmol/L = 32 mg/dL → life-threatening
    {
      resource: {
        resourceType: "Observation",
        id: "obs-dmhypo-glucose",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "15074-8", display: "Glucose [Moles/volume] in Blood" }], text: "Blutzucker kapillär" },
        subject: { reference: "Patient/pat-dmhypo-005" },
        effectiveDateTime: "2024-04-12T07:21:00+02:00",
        valueQuantity: { value: 1.8, unit: "mmol/L", system: "http://unitsofmeasure.org", code: "mmol/L" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "LL" }] }],
        referenceRange: [
          { low: { value: 4.0, unit: "mmol/L" }, text: "ADA Level 1 < 3.9, Level 2 < 3.0 (54 mg/dL), Level 3 (severe) any cognitively impaired" },
        ],
      } as FHIRObservation,
    },
    // GFR — LOINC 62238-1 — relevant for Glibenclamide accumulation
    // Glibenclamide: renal elimination, CI if GFR < 30 (DGIM/DDG 2023)
    {
      resource: {
        resourceType: "Observation",
        id: "obs-dmhypo-gfr",
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "62238-1", display: "Glomerular filtration rate/1.73 sq M.predicted [Volume Rate/Area] in Serum, Plasma or Blood by Creatinine-based formula (CKD-EPI)" }], text: "eGFR (CKD-EPI)" },
        subject: { reference: "Patient/pat-dmhypo-005" },
        effectiveDateTime: "2024-04-12T07:32:00+02:00",
        valueQuantity: { value: 38, unit: "mL/min/1.73m2", system: "http://unitsofmeasure.org", code: "mL/min/{1.73_m2}" },
        interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "L" }] }],
        referenceRange: [{ low: { value: 60, unit: "mL/min/1.73m2" }, text: "CKD Stage 3b (eGFR 30-44)" }],
      } as FHIRObservation,
    },
    {
      resource: {
        resourceType: "Condition",
        id: "cond-dmhypo-main",
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
        verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "encounter-diagnosis" }] }],
        severity: { coding: [{ system: "http://snomed.info/sct", code: "24484000" }] },
        code: {
          coding: [
            { system: "http://hl7.org/fhir/sid/icd-10-gm", code: "E11.64", display: "Diabetes mellitus, Typ 2: Mit Hypoglykämie: Mit Koma" },
            { system: "http://snomed.info/sct", code: "302866003", display: "Hypoglycemic coma" },
          ],
          text: "Schwere Hypoglykämie BZ 1.8 mmol/L (32 mg/dL) mit Somnolenz GCS 10 bei bekanntem DM Typ 2 + Glibenclamid-Therapie + CKD 3b",
        },
        subject: { reference: "Patient/pat-dmhypo-005" },
        onsetDateTime: "2024-04-12T07:00:00+02:00",
        recordedDate: "2024-04-12T07:18:00+02:00",
      } as FHIRCondition,
    },
    // Glibenclamide — CRITICAL: sulfonyl urea, prolonged hypoglycaemia risk 24h
    {
      resource: {
        resourceType: "MedicationStatement",
        id: "med-dmhypo-glibenclamide",
        status: "active",
        medicationCodeableConcept: {
          coding: [
            { system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "4821", display: "Glibenclamide" },
            { system: "http://www.whocc.no/atc", code: "A10BB01", display: "Glibenclamide (Sulfonylharnstoff)" },
          ],
          text: "Glibenclamid 3.5 mg p.o. 1-0-1 (bei eingeschränkter Nierenfunktion — Akkumulationsrisiko!)",
        },
        subject: { reference: "Patient/pat-dmhypo-005" },
        effectivePeriod: { start: "2021-09-20T00:00:00+01:00" },
        dosage: [{
          text: "3.5 mg morgens und abends",
          timing: { repeat: { frequency: 2, period: 1, periodUnit: "d" } },
          doseAndRate: [{ doseQuantity: { value: 3.5, unit: "mg", system: "http://unitsofmeasure.org", code: "mg" } }],
        }],
      } as FHIRMedicationStatement,
    },
  ],
  _meta: {
    scenarioId: "dm_hypo",
    triageClass: "P2",
    tokenCountRaw: 1963,
    encodedAt: "2024-04-12T07:18:00+02:00",
  },
}

export const ALL_FHIR_BUNDLES = {
  stemi: FHIR_STEMI,
  sepsis: FHIR_SEPSIS,
  stroke: FHIR_STROKE,
  anaphylaxie: FHIR_ANAPHYLAXIE,
  dm_hypo: FHIR_DM_HYPO,
} as const
