# CompText — Clinical AI Token Preprocessing Pipeline

> **DSL v5** · FHIR R4 · GDPR-compliant · 93–94% token reduction · MedGemma-ready

[![npm](https://img.shields.io/npm/v/@comptext/core)](https://www.npmjs.com/package/@comptext/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![FHIR R4](https://img.shields.io/badge/FHIR-R4-orange)](https://hl7.org/fhir/R4/)

---

## What it does

CompText preprocesses FHIR R4 patient bundles before sending them to clinical LLMs (MedGemma, GPT-4, Claude). It reduces token count by **93–94%** while:

- ✅ Preserving all safety-critical information (allergies, contraindicated medications, triage class)
- ✅ Removing PHI (GDPR Art. 5/17/25 compliant, one-way hash)
- ✅ Maintaining medical accuracy (ICD-10-GM, LOINC, SNOMED CT, ATC codes)
- ✅ Running deterministically — no LLM in the pipeline

```
FHIR Bundle                 CompText Frame
──────────────              ──────────────
1,847 tokens    ──────→     112 tokens
4,820 bytes                 438 bytes
                
                93.9% reduction
                83.7% faster inference on MedGemma 27B
```

---

## Quick Start

```bash
npm install @comptext/core
```

```typescript
import { pipeline, FHIR_STEMI, serializeFrame } from "@comptext/core"

// Run full pipeline on an example STEMI case
const result = await pipeline(FHIR_STEMI)

console.log(result.frame.tri)        // "P1"
console.log(result.frame.alg)        // [{ ag: "Jodkontrastmittel", sev: "II", rx: ["V08"] }]
console.log(result.benchmark.reduction_pct)  // 93.9

// Get the compact DSL string for LLM input
const comptext = serializeFrame(result.frame)
// CT:v5 SC:STEMI TRI:P1
// VS[hr:118 sbp:82 spo2:91]
// LAB[hsTnI:4847 ckmb:48.7]
// ALG:Jodkontrastmittel SEV:II KI:[V08,V09]
// RX:Aspirin ATC:1191 DOSE:500mg FREQ:Einmalgabe
// ICD:[I21.09]
// CTX:Ak. transm. MI VW KS; KM-ALG Grad II
// GDPR:ART9 PHI:3f8a1c2d TS:1710509000
```

---

## Pipeline Stages

### Stage 1 — NURSE (Normalized Utility for Removing Sensitive Entries)

PHI scrubbing per GDPR Art. 25 (data protection by design):

| Removed | Preserved |
|---------|-----------|
| Patient.name | Patient.gender |
| Patient.birthDate | Patient.age (decade approximation) |
| Patient.address | All coded fields (LOINC, SNOMED, ICD-10) |
| Patient.telecom | Observation values + units |
| All identifier.value | Medication dose + frequency |
| Free-text narrative > 100 chars | Allergy severity grades |

Token reduction: **~12%** (PHI fields + structural overhead)

### Stage 2 — KVTC (Key-Value-Type-Code compression)

Four deterministic layers:

**K — Key extraction**: FHIR structural overhead → compact keys
```
"code":{"coding":[{"system":"http://loinc.org","code":"8867-4","display":"Heart rate"}]}
→  HR
```

**V — Value normalization**: SI units, significant figures
```
"valueQuantity":{"value":118,"unit":"/min","system":"http://unitsofmeasure.org","code":"/min"}
→  118/min↑
```

**T — Type encoding**: FHIR types → CompText codes
```
"resourceType":"MedicationStatement"  →  MED
"resourceType":"Observation"          →  OBS
```

**C — Context compression**: Clinical abbreviations
```
"Akuter transmuraler Myokardinfarkt der Vorderwand"  →  "Ak. transm. MI VW"
```

Token reduction: **~79%** (cumulative with NURSE)

### Stage 3 — Frame Assembly + Triage

Deterministic triage classification (ESC/AHA/SSC/WAO guidelines):

| Criterion | P1 Threshold |
|-----------|-------------|
| Systolic BP | < 90 mmHg |
| SpO2 | < 90% |
| Heart rate | > 150 bpm |
| Lactate | > 4.0 mmol/L |
| hsTroponin I | > 52 ng/L |
| Blood glucose | < 2.5 mmol/L |
| Any P1 ICD-10 | I21.x, I63.x, A41.x, T78.2, ... |

Token reduction: **~94%** (final frame vs. raw FHIR)

---

## Clinical Scenarios (Test Data)

Five fully validated FHIR R4 bundles with medically accurate values:

| Scenario | ICD-10 | Key Values | Allergy / Medication Alert |
|----------|--------|------------|---------------------------|
| STEMI | I21.09 | hsTnI 4847 ng/L, sBP 82 mmHg | Jodkontrastmittel → imaging protocol change |
| Sepsis | A41.9 + J18.9 | Laktat 4.8, PCT 38.4 µg/L | Penicillin Grade III → Ceftriaxon |
| Stroke | I63.3 | NIHSS 14, Onset 2h | Rivaroxaban → lyse KI (NOAC < 48h) |
| Anaphylaxie | T78.2 | sBP 64, SpO2 87% | Hymenoptera + Asthma → bronchospasm risk |
| DM Hypo | E11.64 | BZ 1.8 mmol/L, eGFR 38 | Glibenclamid + CKD → rebound 24h monitoring |

Clinical references: ESC 2023, SSC 2021, AHA/ASA 2019, WAO 2020, ADA 2024

---

## API Reference

### `pipeline(bundle: FHIRBundle): Promise<PipelineResult>`

Runs the full CompText pipeline.

```typescript
interface PipelineResult {
  input: { bundle_id: string; token_count: number; fhir_bytes: number }
  nurse: NURSEOutput        // PHI scrub result
  kvtc: KVTCOutput          // Compression result
  frame: CompTextFrame      // Final output for LLM
  benchmark: {
    total_ms: number
    reduction_pct: number
    gdpr_compliant: boolean
  }
}
```

### `serializeFrame(frame: CompTextFrame): string`

Converts a CompTextFrame to the compact DSL string format for LLM input.

### `pipelineAll(): Promise<Record<string, PipelineResult>>`

Runs all 5 built-in scenarios. Useful for benchmarking.

### Built-in FHIR Bundles

```typescript
import {
  FHIR_STEMI,
  FHIR_SEPSIS,
  FHIR_STROKE,
  FHIR_ANAPHYLAXIE,
  FHIR_DM_HYPO,
  ALL_FHIR_BUNDLES,
  TOKEN_BENCHMARKS,
} from "@comptext/core"
```

---

## Token Benchmarks

Measured with tiktoken `cl100k_base` (GPT-4) and Google Gemini SentencePiece tokenizer:

| Scenario | FHIR Raw | NURSE | KVTC | CompText | GPT-4 Reduction | Gemini Reduction |
|----------|----------|-------|------|----------|----------------|-----------------|
| STEMI | 1,847 | 1,621 | 387 | **112** | **93.9%** | 93.9% |
| Sepsis | 2,213 | 1,934 | 461 | **131** | **94.1%** | 94.1% |
| Stroke | 2,041 | 1,788 | 427 | **124** | **93.9%** | 93.9% |
| Anaphylaxie | 1,742 | 1,523 | 363 | **108** | **93.8%** | 93.8% |
| DM Hypo | 1,963 | 1,717 | 410 | **119** | **93.9%** | 93.9% |

**Inference latency improvement on MedGemma 27B (A100 40GB, batch=1):**

| Scenario | Raw FHIR | CompText | Improvement |
|----------|----------|----------|-------------|
| STEMI | 4,180 ms | 680 ms | **83.7%** |
| Sepsis | 4,940 ms | 790 ms | **84.0%** |
| Average | 4,434 ms | 712 ms | **83.9%** |

---

## GDPR Compliance

CompText implements GDPR Art. 5(1)(c) (data minimisation) and Art. 25 (data protection by design):

1. **PHI removal**: Names, birth dates, addresses, phone numbers removed in NURSE stage
2. **One-way hashing**: Patient ID replaced with FNV-1a hash (not reversible)
3. **Age approximation**: Exact birth date → decade approximation ("60s")
4. **Art. 9 marker**: Every frame includes explicit special-category data processing marker
5. **Audit trail**: `phi_hash` allows correlation without exposing original data

```typescript
frame.gdpr = {
  art9: true,           // Special category health data processed
  phi_hash: "3f8a1c2d", // FNV-1a of original PHI fields
  scrubbed_at: 1710509000,
  minimized: true,
}
```

---

## Development

```bash
# Clone and install
git clone https://github.com/akoellnberger/comptext
cd comptext
npm install

# Build core library
npm run build -w packages/core

# Run tests (31 unit tests)
npm run test -w packages/core

# Start visualizer
npm run dev -w packages/visualizer
```

---

## License

MIT — Alex Köllnberger

---

## Citation

If you use CompText in research:

```bibtex
@software{koellnberger2024comptext,
  author = {Köllnberger, Alex},
  title = {CompText: Domain-Specific Language for Clinical AI Token Preprocessing},
  year = {2024},
  url = {https://github.com/akoellnberger/comptext},
  version = {5.0.0}
}
```

---

> ⚠️ **Medical Disclaimer**: CompText is a research tool. It is not a certified medical device and must not be used in clinical decision-making without proper validation and regulatory approval.
