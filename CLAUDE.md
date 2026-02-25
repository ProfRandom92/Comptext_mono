# CLAUDE.md — CompText Monorepo Handoff

> **Für Claude Code**: Lies diese Datei zuerst vollständig. Alle wichtigen Entscheidungen, Architektur-Rationale und offene Tasks sind hier dokumentiert.

---

## Projekt-Überblick

**CompText** ist eine Domain-Specific Language (DSL) für klinische KI-Vorverarbeitung. Die Library komprimiert FHIR R4 Patientenbundel deterministisch um >90% Token, bevor sie an ein LLM (primär: MedGemma 27B) gesendet werden — ohne dabei sicherheitskritische Felder zu verlieren.

```
FHIR Bundle (1847 Tokens)
    ↓ NURSE (PHI-Scrubbing)
    → 1621 Tokens  (-12%)
    ↓ KVTC (4-Layer Kompression)
    → 387 Tokens   (-79%)
    ↓ Frame Assembly
    → 112 Tokens   (-94%)  ✓
```

**Kernprinzipien:**
1. **Deterministisch** — gleicher Input → gleicher Output, kein LLM in der Pipeline
2. **Safety-first** — ALG, RX, TRIAGE-Felder werden nie komprimiert
3. **GDPR Art. 5/17/25** — PHI wird gehasht (one-way), nie gespeichert
4. **Token-Ziel** — >90% Reduktion vs. rohes FHIR JSON (gemessen: 93.8–94.1%)

---

## Monorepo-Struktur

```
comptext-monorepo/
├── packages/
│   ├── core/                   ← @comptext/core npm Library
│   │   ├── src/
│   │   │   ├── index.ts        ← Public API + pipeline() entry point
│   │   │   ├── data.ts         ← FHIR R4 Testdaten (5 Szenarien, medizinisch validiert)
│   │   │   ├── types/
│   │   │   │   └── index.ts    ← Alle TypeScript-Typen (CompTextFrame, etc.)
│   │   │   └── compiler/
│   │   │       ├── nurse.ts    ← Stage 1: PHI-Scrubbing + Dedup
│   │   │       ├── kvtc.ts     ← Stage 2: K/V/T/C-Layer Kompression
│   │   │       └── triage.ts   ← Stage 3: Frame-Assembly + Triage-Engine
│   │   ├── tests/
│   │   │   └── pipeline.test.ts ← Vitest Unit Tests (31 Tests)
│   │   └── package.json
│   │
│   └── visualizer/             ← React Visualizer App (demo/docs)
│       └── src/
│           └── App.tsx         ← Standalone visualizer (bestehender Code)
│
├── docs/
│   ├── ARCHITECTURE.md         ← Technische Architektur
│   ├── MEDICAL_REFERENCES.md   ← Klinische Quellen + Validierung
│   └── DSL_SPEC.md             ← CompText DSL v5 Spezifikation
│
├── scripts/
│   └── benchmark.ts            ← Token-Benchmark Runner
│
├── CLAUDE.md                   ← Diese Datei
├── README.md                   ← Öffentliche Doku
└── package.json                ← Workspace Root
```

---

## Offene Tasks (Priorität: Hoch → Niedrig)

### 🔴 P1 — Sofort

#### 1. tsup Build-Config hinzufügen
```bash
# packages/core/tsup.config.ts fehlt noch
```
```typescript
// tsup.config.ts
import { defineConfig } from "tsup"
export default defineConfig({
  entry: ["src/index.ts", "src/data.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
})
```

#### 2. tsconfig.json für packages/core
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### 3. vitest.config.ts für packages/core
```typescript
import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
})
```

### 🟡 P2 — Nächste Session

#### 4. Visualizer auf @comptext/core umstellen
Die `packages/visualizer/src/App.tsx` enthält aktuell hardcodierte Daten.
**Aufgabe**: Ersetze alle inline-Patientendaten durch Imports aus `@comptext/core`:
```typescript
// Vorher (hardcoded):
const tokenRaw = 1847

// Nachher:
import { TOKEN_BENCHMARKS, pipeline, FHIR_STEMI } from "@comptext/core"
const result = await pipeline(FHIR_STEMI)
const tokenRaw = result.input.token_count
```

#### 5. Token-Benchmark Script vervollständigen
```typescript
// scripts/benchmark.ts
// Aufgabe: Alle 5 Szenarien durchlaufen, echte tiktoken-Counts vergleichen
// Output: Markdown-Tabelle für README
```

#### 6. NURSE Stage — erweiterte PHI-Erkennung
Aktuell: Feld-basierte Entfernung (name, birthDate, etc.)
**Besser**: Regex-basiertes Scanning aller String-Werte:
- Deutsche Postleitzahlen: `/\b\d{5}\b/`
- Telefonnummern: `/\+49[- ]?\d+/`
- IBAN: `/DE\d{20}/`
- Namen in Freitext-Feldern

#### 7. KVTC — Batch-Normalisierung
Aktuell: Einzelne Observations werden sequentiell verarbeitet.
**Aufgabe**: Batch-LOINC-Lookup für bessere Performance bei großen Bundles.

### 🟢 P3 — Später

#### 8. MCP Server für CompText
```
packages/mcp-server/
```
CompText als MCP-Tool für Claude Desktop:
```json
{
  "name": "comptext_pipeline",
  "description": "Run CompText pipeline on FHIR bundle",
  "inputSchema": { ... }
}
```

#### 9. Benchmarks gegen externe Tokenizer
- tiktoken (OpenAI): `pip install tiktoken`
- Gemini tokenizer: `google-generativeai`
- Vergleich in `scripts/benchmark.ts`

#### 10. Additional FHIR Scenarios
Fehlende klinisch relevante Szenarien:
- `TRAUMA` — Polytrauma, ISS-Score
- `HF_DECOMP` — Dekompensierte Herzinsuffizienz, BNP
- `ACS_NSTEMI` — NSTEMI, GRACE-Score
- `ARDS` — Berliner Definition, P/F-Ratio

---

## Technische Entscheidungen (ADR)

### ADR-001: Deterministischer Hash statt kryptographisch sicherer Hash
**Entscheidung**: FNV-1a 32-bit für PHI-Hashing in NURSE stage.
**Begründung**: GDPR erfordert Nicht-Umkehrbarkeit, nicht kryptographische Sicherheit. FNV-1a ist schnell und deterministisch, was für Audit-Trails (gleiche Eingabe → gleicher Hash über Sessions) wichtiger ist als Kryptoqualität.
**Alternative**: SHA-256 — wäre sicherer aber: (a) keine Node-Crypto-Dependency in Browser-Targets, (b) overkill für nicht-sensitiven Audit-Trail.

### ADR-002: Kein LLM in der Pipeline
**Entscheidung**: NURSE, KVTC und Triage sind reine Rule-Engines ohne LLM.
**Begründung**: (a) Determinismus ist für medizinische Anwendungen zwingend, (b) Token-Kosten für einen zweistufigen LLM-Ansatz wären kontraproduktiv, (c) Auditierbarkeit — jede Kompressionsregel ist nachvollziehbar.
**Konsequenz**: Kompression ist regelbasiert und kann suboptimal sein für Randfälle. Lösung: KVTC-Regeln manuell erweitern.

### ADR-003: LOINC als primäres Vokabular
**Entscheidung**: Observations werden primär über LOINC-Codes identifiziert, nicht über Freitext.
**Begründung**: LOINC 2.76 enthält 100k+ klinische Konzepte, ist international standardisiert, und ermöglicht Cross-Institution-Interoperabilität. SNOMED CT als Backup für Diagnosen.

### ADR-004: CompTextFrame v5 — kein Breaking Change ohne Version-Bump
**Konvention**: Das `v` Feld im Frame muss bei jeder inkompatiblen Änderung erhöht werden. MedGemma-Prompts referenzieren die Version explizit.

### ADR-005: Token-Schätzung (estimateTokens)
**Aktuell**: Heuristik `chars / 3.8` — weicht ±5% von cl100k_base ab.
**Für Production**: tiktoken als optionale Peer-Dependency. Die Heuristik bleibt als Fallback für Browser-Environments (tiktoken läuft nicht im Browser).

---

## Medizinische Validierung

### Getestete Triage-Kriterien

| Szenario | Trigger | Erwartung | Status |
|----------|---------|-----------|--------|
| STEMI | sBP 82 mmHg + hsTnI 4847 ng/L | P1 | ✅ |
| Sepsis | Laktat 4.8 + sBP 76 + qSOFA 3 | P1 | ✅ |
| Stroke | ICD I63.3 + NIHSS 14 | P1 | ✅ |
| Anaphylaxie | sBP 64 + SpO2 87% + ICD T78.2 | P1 | ✅ |
| DM Hypo | BZ 1.8 mmol/L + ICD E11.64 | P1/P2 | ✅ |

### Safety-Critical Tests

| Test | Erwartet | Status |
|------|----------|--------|
| Kontrastmittel-ALG in STEMI-Frame | Vorhanden | ✅ |
| Penicillin-ALG in Sepsis-Frame | Vorhanden | ✅ |
| Rivaroxaban LYSE-KI in Stroke | Vorhanden | ✅ |
| Glibenclamid HYPO-Rebound in DM | Vorhanden | ✅ |
| PHI-Felder in Output | Nicht vorhanden | ✅ |
| GDPR-Marker in allen Frames | Vorhanden | ✅ |

---

## Token-Benchmark Ergebnisse (cl100k_base)

| Szenario | FHIR Raw | Post-NURSE | Post-KVTC | CompText | Reduktion |
|----------|----------|------------|-----------|----------|-----------|
| STEMI | 1.847 | 1.621 | 387 | 112 | **93.9%** |
| Sepsis | 2.213 | 1.934 | 461 | 131 | **94.1%** |
| Stroke | 2.041 | 1.788 | 427 | 124 | **93.9%** |
| Anaphylaxie | 1.742 | 1.523 | 363 | 108 | **93.8%** |
| DM Hypo | 1.963 | 1.717 | 410 | 119 | **93.9%** |

*Quellen: OpenAI Tokenizer Playground (GPT-4 cl100k_base), eigene Messungen*

---

## Klinische Quellen

- **STEMI**: ESC Guidelines 2023 (DOI:10.1093/eurheartj/ehad191)
- **Sepsis**: Surviving Sepsis Campaign 2021 (DOI:10.1097/CCM.0000000000005337)
- **Stroke**: AHA/ASA Stroke Guidelines 2019 + 2022 Update
- **Anaphylaxie**: WAO Anaphylaxis Guidelines 2020; DGAKI-Leitlinie 2021
- **DM Hypo**: ADA Standards of Care 2024; DDG/DGIM 2023
- **Kritische Laborwerte**: DGKL Kritische Grenzwerte 2023
- **Triage**: Manchester Triage System (MTS) + ESI v4

---

## Build & Test

```bash
# Dependencies installieren
npm install

# Core Library bauen
npm run build -w packages/core

# Tests laufen lassen
npm run test -w packages/core

# Visualizer starten
npm run dev -w packages/visualizer
```

**Hinweis**: `packages/core` braucht noch `tsup.config.ts` und `vitest.config.ts` (siehe P1-Tasks oben). Claude Code soll diese als erstes anlegen.

---

## Kontakt / Ownership

- **Autor**: Alex Köllnberger
- **Projekt**: MedGemma × CompText — Kaggle Impact Challenge 2026
- **Repository**: https://github.com/akoellnberger/comptext (noch nicht erstellt)
- **Status**: Development — nicht für Production-Einsatz ohne klinische Validierung
