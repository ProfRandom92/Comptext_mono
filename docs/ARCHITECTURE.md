# CompText — Technische Architektur

## Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│                    CompText Pipeline v5                         │
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  FHIR R4 │    │  NURSE   │    │   KVTC   │    │  Frame   │  │
│  │  Bundle  │───▶│  Stage   │───▶│  Stage   │───▶│Assembler │  │
│  │          │    │          │    │          │    │          │  │
│  │1847 tok  │    │1621 tok  │    │ 387 tok  │    │ 112 tok  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│                  PHI Scrub      K V T C         Triage +        │
│                  Dedup          Layers           GDPR Frame      │
└─────────────────────────────────────────────────────────────────┘
                                                         │
                                                         ▼
                                              ┌──────────────────┐
                                              │   MedGemma 27B   │
                                              │   (or any LLM)   │
                                              └──────────────────┘
```

---

## Stage 1 — NURSE

**Ziel**: PHI-Entfernung nach GDPR Art. 25, Deduplication von Observations

**Input**: `FHIRBundle` (R4 compliant)
**Output**: `NURSEOutput` — bereinigtes Ressource-Array ohne PHI

### PHI-Entfernung

```
Patient.name         → ENTFERNT
Patient.birthDate    → Jahrgang-Dekade ("60s")
Patient.address      → ENTFERNT
Patient.telecom      → ENTFERNT
Patient.identifier   → FNV-1a Hash (8 hex chars)
```

**Preserved (klinisch relevant)**:
- `Patient.gender` — klinisch relevant (Referenzbereiche, Medikation)
- Alle `code.coding[]` Arrays (LOINC, SNOMED, ICD-10, ATC)
- Alle `valueQuantity` (Messwerte + Einheiten)
- `interpretation.coding[].code` (H/L/HH/LL)
- `onsetDateTime` (anonymisiert auf Tages-Granularität)

### Deduplication

```typescript
// Duplicate LOINC codes werden dedupliziert — letzte Messung gewinnt
const seenObsLoinc = new Set<string>()
// if seenObsLoinc.has(loinc) → skip
```

### Token-Reduktion NURSE Stage

| Quelle | Einsparung |
|--------|-----------|
| Patient.name (avg 3 Tokens) | 3T |
| birthDate → Dekade | 2T |
| address (6+ Felder) | 12T |
| telecom | 4T |
| identifier.value × 2 | 6T |
| FHIR Metadata (meta, profile, ...) | 45T |
| Strukturelle Keys (resourceType, etc.) | 100T |
| **Gesamt** | **~172T (-12%)** |

---

## Stage 2 — KVTC

**Vier deterministische Layer, sequentiell ausgeführt:**

### K-Layer — Key Extraction

Mappt LOINC-Codes auf klinische Kürzel:

```
LOINC 89579-7  →  hsTnI
LOINC 8867-4   →  HR
LOINC 59408-5  →  SpO2
LOINC 2519-7   →  LAC
LOINC 33959-8  →  PCT
```

Vollständige Tabelle: `packages/core/src/compiler/kvtc.ts:LOINC_TO_KEY`

### V-Layer — Value Normalization

**SI-Unit Normalisierung:**
```
"mm[Hg]"  →  "mmHg"
"ug/L"    →  "µg/L"
"mL/min/{1.73_m2}"  →  "ml/min/1.73m²"
```

**Compact Notation:**
```
HR:118/min↑   (nicht: "valueQuantity":{"value":118,"unit":"/min","code":"/min",...})
hsTnI:4847ng/L↑↑
LAC:4.8mmol/L↑↑
```

**Critical Flag**: `critical: true` für HH/LL Interpretationen.

### T-Layer — Type Encoding

```
Observation      →  OBS
Condition        →  DX
MedicationStatement  →  MED
AllergyIntolerance   →  ALG
```

### C-Layer — Context Compression

Klinische Abkürzungstabelle (48 Paare):

```
"Akuter transmuraler Myokardinfarkt der Vorderwand"
→ "Ak. transm. MI VW"

"Septischer Schock bei ambulant erworbener Pneumonie"
→ "SepS bei CAP"

"Kontrastmittel-Allergie (jodhaltig)"
→ "KM-ALG"
```

---

## Stage 3 — Frame Assembly + Triage Engine

### Triage-Algorithmus

Basiert auf internationalen Leitlinien (ESC, AHA/ASA, SSC, WAO, ADA):

```
P1 wenn IRGENDEIN der folgenden zutrifft:
  sBP < 90 mmHg           (kardiogener Schock, septischer Schock)
  SpO2 < 90%              (respiratorische Insuffizienz)
  HR > 150 /min           (hämodynamische Instabilität)
  Laktat > 4.0 mmol/L     (SSC 2021: septischer Schock)
  hsTnI > 52 ng/L         (ESC 2023: hohe STEMI-Wahrscheinlichkeit)
  BZ < 2.5 mmol/L         (ADA Level 3: schwere Hypoglykämie)
  PCT > 10 µg/L           (SSC 2021: septischer Schock)
  ICD ∈ {I21.x, I63.x, A41.x, T78.2, I60.x, ...}

P2 wenn IRGENDEIN der folgenden zutrifft:
  sBP ∈ (90, 100) mmHg
  SpO2 ∈ (90%, 94%)
  HR ∈ (120, 150) /min
  Laktat > 2.0 mmol/L
  BZ ∈ (2.5, 3.5) mmol/L

P3: alle anderen
```

### CompText Frame v5 Struktur

```typescript
{
  v: "5",                    // Schema-Version
  sc: "STEMI",               // Szenario-Code
  tri: "P1",                 // Triage-Klasse
  alg: [...],                // Allergien — NIE komprimiert
  rx: [...],                 // Medikamente + klinische Flags
  vs: { hr: 118, sbp: 82 },  // Vitalzeichen
  lab: { hs_tni: 4847 },     // Laborwerte
  ctx: "Ak. transm. MI VW KS; KM-ALG Grad II",
  icd: ["I21.09"],
  ts: 1710509000,            // Unix epoch
  gdpr: { art9: true, phi_hash: "3f8a1c2d", ... }
}
```

---

## Datenfluss

```
FHIRBundle
    │
    ├── entry[0]: Patient
    │       └── id, gender, birthDate, name, address, telecom
    │
    ├── entry[1..n]: Observation
    │       └── loinc, value, unit, interpretation, referenceRange
    │
    ├── entry[n+1..m]: Condition
    │       └── icd10, snomed, text, severity, onset
    │
    └── entry[m+1..]: MedicationStatement
            └── rxnorm, atc, name, dose, freq
    
    ↓ NURSE
    
NURSEOutput
    │
    ├── phi_hash: "3f8a1c2d"
    ├── token_in: 1847, token_out: 1621
    └── resources: [
            { type: "Patient",   fields: { gender, age_approx } },
            { type: "Observation", fields: { loinc, value, unit, interp } },
            { type: "Condition",   fields: { icd10, snomed, text, severity } },
            { type: "MED",         fields: { atc, name, dose, freq } },
        ]
    
    ↓ KVTC
    
KVTCOutput
    │
    ├── layer_k: { pairs: [{ loinc, display:"HR", value:118, unit:"/min" }] }
    ├── layer_v: { normalized: [{ key:"HR", compact:"HR:118/min↑" }] }
    ├── layer_t: { encoded: { Observation: "OBS" } }
    ├── layer_c: { narrative: "Ak. transm. MI VW KS; KM-ALG Grad II" }
    └── token_in: 1621, token_out: 387
    
    ↓ assembleFrame
    
CompTextFrame
    │
    └── (siehe oben) token_out: ~112
```

---

## Fehlerbehandlung

```typescript
// Alle Fehler sind typisiert:
throw new CompTextError(
  "Bundle has no entries",
  "NO_RESOURCES",     // Error-Code
  { bundle_id: "..." } // Kontext (für Logging, kein PHI!)
)
```

Error Codes:
- `INVALID_FHIR` — Input ist kein gültiges FHIR Bundle
- `PHI_SCRUB_FAILED` — NURSE Stage fehlgeschlagen
- `KVTC_ERROR` — Kompression fehlgeschlagen
- `TRIAGE_UNKNOWN` — Kein Triage-Kriterium erkannt
- `NO_RESOURCES` — Bundle ist leer

---

## Performance

| Operation | Durchschnitt | P99 |
|-----------|-------------|-----|
| NURSE Stage | 2 ms | 5 ms |
| KVTC Stage | 3 ms | 8 ms |
| Frame Assembly | 1 ms | 3 ms |
| **Pipeline gesamt** | **~6 ms** | **16 ms** |

*Node.js 20, M2 Pro, single-threaded. FHIR Bundle ~5KB.*

Bottleneck ist derzeit die JSON-Serialisierung in `estimateTokens()`.
Für Production: tiktoken als native Binding verwenden (10-50x schneller).

---

## Erweiterbarkeit

### Neue Szenarien hinzufügen

1. FHIR Bundle in `packages/core/src/data.ts` definieren
2. Szenario-Code in `types/index.ts:ScenarioCode` ergänzen
3. ICD-10-Muster in `compiler/triage.ts:ICD10_P1_PATTERNS` (falls P1)
4. Klinische Abkürzungen in `compiler/kvtc.ts:CLINICAL_ABBREV` ergänzen
5. Token-Benchmark in `TOKEN_BENCHMARKS` eintragen
6. Tests in `tests/pipeline.test.ts` hinzufügen

### Neuen LOINC-Code unterstützen

```typescript
// compiler/kvtc.ts
const LOINC_TO_KEY: Record<string, string> = {
  // ... bestehende Einträge ...
  "YOUR_LOINC": "ABBREV",
}
```

### Neuen Allergy-Typ unterstützen

```typescript
// compiler/triage.ts
const ALLERGY_SNOMED_MAP: Record<string, ...> = {
  // ... bestehende Einträge ...
  "YOUR_SNOMED": { name: "AllergenName", sev: "II", ki: ["ATC_CODE"] },
}
```
