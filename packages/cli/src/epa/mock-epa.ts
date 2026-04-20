// Mock ePA (elektronische Patientenakte) — synthetische Testdaten
// Daten sind vollständig fiktiv, niemals echte Patientendaten

import type { FHIRBundle } from "@comptext/core"

export type Scenario = "stemi" | "sepsis" | "stroke" | "anaphylaxie" | "dm_hypo"

export interface EPAPatient {
  kvnr: string            // 10-stellig: 1 Buchstabe + 9 Ziffern
  name_family: string
  name_given: string
  birthdate: string       // ISO: YYYY-MM-DD
  gender: "male" | "female"
  address_line: string
  postal_code: string
  city: string
  insurance_name: string
  insurance_iknr: string  // 9-stellig
  insurance_type: "GKV" | "PKV"
}

export interface EPATIContext {
  ti_id: string           // TI-Session-ID (simuliert)
  accessed_by: string     // Institution + Arzt/Sanitäter
  access_reason: string   // Klinische Begründung
  access_type: "emergency_access"
  consent_basis: string   // §291a SGB V
  timestamp: string       // ISO
  mios: string[]          // Medizinische Informationsobjekte
}

export interface EPABundle {
  scenario: Scenario
  patient: EPAPatient
  ti_context: EPATIContext
  fhir: FHIRBundle
  phi_field_count: number
}

// ── Synthetische Patienten ────────────────────────────────────────────────────

export const MOCK_EPA_PATIENTS: Record<Scenario, EPAPatient> = {
  stemi: {
    kvnr:           "A123456789",
    name_family:    "Wagner",
    name_given:     "Klaus-Dieter",
    birthdate:      "1958-03-14",
    gender:         "male",
    address_line:   "Rohrbacher Str. 44",
    postal_code:    "69115",
    city:           "Heidelberg",
    insurance_name: "AOK Baden-Württemberg",
    insurance_iknr: "108018007",
    insurance_type: "GKV",
  },
  sepsis: {
    kvnr:           "B987654321",
    name_family:    "Müller",
    name_given:     "Ingrid",
    birthdate:      "1943-11-28",
    gender:         "female",
    address_line:   "Plöck 12",
    postal_code:    "69117",
    city:           "Heidelberg",
    insurance_name: "Techniker Krankenkasse",
    insurance_iknr: "101575519",
    insurance_type: "GKV",
  },
  stroke: {
    kvnr:           "C246813579",
    name_family:    "Schneider",
    name_given:     "Thomas",
    birthdate:      "1965-07-09",
    gender:         "male",
    address_line:   "Bergheimer Str. 91",
    postal_code:    "69115",
    city:           "Heidelberg",
    insurance_name: "Barmer",
    insurance_iknr: "104940005",
    insurance_type: "GKV",
  },
  anaphylaxie: {
    kvnr:           "D135792468",
    name_family:    "Bauer",
    name_given:     "Sabine",
    birthdate:      "1989-05-22",
    gender:         "female",
    address_line:   "Hauptstr. 18",
    postal_code:    "69151",
    city:           "Neckargemünd",
    insurance_name: "DAK-Gesundheit",
    insurance_iknr: "101570104",
    insurance_type: "GKV",
  },
  dm_hypo: {
    kvnr:           "E192837465",
    name_family:    "Fischer",
    name_given:     "Gerhard",
    birthdate:      "1951-09-03",
    gender:         "male",
    address_line:   "Kurfürstenanlage 22",
    postal_code:    "69118",
    city:           "Heidelberg",
    insurance_name: "Barmer",
    insurance_iknr: "104940005",
    insurance_type: "GKV",
  },
}

const TI_CONTEXTS: Record<Scenario, Pick<EPATIContext, "accessed_by" | "access_reason" | "mios">> = {
  stemi: {
    accessed_by:   "Notaufnahme UKHD — Dr. Meyer",
    access_reason: "Akuter Thoraxschmerz, STEMI-Verdacht",
    mios: ["Medikationsliste", "Allergien", "Vordiagnosen", "EKG-Befunde"],
  },
  sepsis: {
    accessed_by:   "RTW 1-HD-42 — NotSan Becker",
    access_reason: "Septischer Schock, qSOFA ≥2",
    mios: ["Medikationsliste", "Vordiagnosen", "Laborbefunde", "Impfstatus"],
  },
  stroke: {
    accessed_by:   "Stroke-Unit UKHD — Dr. Lang",
    access_reason: "Akute Hemiparese, Lyse-Fenster offen",
    mios: ["Medikationsliste", "Allergien", "Vordiagnosen", "Bildgebung"],
  },
  anaphylaxie: {
    accessed_by:   "RTW 2-HD-17 — NotSan Roth",
    access_reason: "Anaphylaktische Reaktion nach KM-Gabe",
    mios: ["Allergien", "Medikationsliste", "Vordiagnosen"],
  },
  dm_hypo: {
    accessed_by:   "Notaufnahme SRH Heidelberg — Dr. Klein",
    access_reason: "Bewusstlosigkeit, BZ 32 mg/dL",
    mios: ["Medikationsliste", "Vordiagnosen", "Laborbefunde", "Diabetespass"],
  },
}

// ── Factory-Funktionen ────────────────────────────────────────────────────────

export function createEmergencyTIContext(scenario: Scenario): EPATIContext {
  const ctx = TI_CONTEXTS[scenario]
  return {
    ...ctx,
    ti_id:         `TI-${Date.now().toString(36).toUpperCase()}`,
    access_type:   "emergency_access",
    consent_basis: "§291a SGB V — Notfallzugriff",
    timestamp:     new Date().toISOString(),
  }
}

export function buildEPABundle(scenario: Scenario, fhirBundle: FHIRBundle): EPABundle {
  return {
    scenario,
    patient:         MOCK_EPA_PATIENTS[scenario],
    ti_context:      createEmergencyTIContext(scenario),
    fhir:            fhirBundle,
    phi_field_count: countPHIFields(MOCK_EPA_PATIENTS[scenario]),
  }
}

export function countPHIFields(patient: EPAPatient): number {
  // KVNR, name_family, name_given, birthdate, address_line, postal_code, city,
  // insurance_name, insurance_iknr → 9 direkte PHI-Felder
  return Object.keys(patient).filter(k => !["gender", "insurance_type"].includes(k)).length
}

export function formatEPAHeader(bundle: EPABundle): string {
  const p = bundle.patient
  const t = bundle.ti_context
  const birthYear = parseInt(p.birthdate.slice(0, 4))
  const age = new Date().getFullYear() - birthYear
  const lines = [
    `KVNR:         ${p.kvnr}`,
    `Patient:      ${p.name_given} ${p.name_family}`,
    `Geboren:      ${p.birthdate.split("-").reverse().join(".")} (${age} Jahre)`,
    `Adresse:      ${p.address_line}, ${p.postal_code} ${p.city}`,
    `Versicherung: ${p.insurance_name} (IKNR: ${p.insurance_iknr}, ${p.insurance_type})`,
    `TI-Session:   ${t.ti_id}`,
    `Zugriff:      ${t.accessed_by}`,
    `Grund:        ${t.access_reason}`,
    `Consent:      ${t.consent_basis}`,
    `MIOs:         ${t.mios.join(", ")}`,
  ]
  return lines.join("\n")
}

// Klinische Hinweise pro Szenario
export const CLINICAL_HINTS: Record<Scenario, string[]> = {
  stemi: [
    "STEMI-Protokoll: Door-to-Balloon < 90 min (Ziel: < 60 min)",
    "KM-Allergie bekannt (Jodhaltiges KM, Schweregrad II) — Prämedikation!",
    "ASS 500 mg i.v. bereits gegeben — Heparin 5000 IE ausstehend",
  ],
  sepsis: [
    "Sepsis-Bundle 1h: Blutkulturen × 2 vor Antibiotikagabe",
    "Antibiotikum innerhalb 1h: Piperacillin/Tazobactam 4,5 g i.v.",
    "Laktat > 2 mmol/L: 30 ml/kg NaCl 0,9% Bolus — Ziel MAP ≥ 65 mmHg",
  ],
  stroke: [
    "Lyse-Fenster: < 4,5h seit Symptombeginn — Alteplase 0,9 mg/kg i.v.",
    "Keine Antikoagulation vor CT-Ausschluss intrazerebraler Blutung",
    "Ziel: Door-to-CT < 25 min, Door-to-Needle < 60 min",
  ],
  anaphylaxie: [
    "Adrenalin 0,5 mg i.m. (Oberschenkel anterolateral) — sofort!",
    "Jodkontrastmittel als Auslöser dokumentiert — Röntgen-KM kontraindiziert",
    "Beobachtung mind. 6–12h wegen biphasischer Reaktion",
  ],
  dm_hypo: [
    "Glukose 40% i.v. — 40 mL (= 16 g) als Bolus, BZ-Kontrolle nach 15 min",
    "Metformin pausieren für 48h (Risiko: Laktatazidose)",
    "Diabetologen-Rücksprache: HbA1c > 9% — Insulintherapie anpassen",
  ],
}
