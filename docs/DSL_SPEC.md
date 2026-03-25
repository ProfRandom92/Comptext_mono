# CompText DSL v5 — Spezifikation

## Syntax

```
CT:v5 SC:{SZENARIO} TRI:{TRIAGE}
VS[{key}:{value}{unit}{flag} ...]
LAB[{key}:{value}{unit}{flag} ...]
ALG:{allergen} SEV:{grade} [KI:[{atc},...]]
RX:{name} ATC:{atc} DOSE:{dose} FREQ:{freq} [KI:[{flags},...]]
ICD:[{code1},{code2},...]
CTX:{komprimierte Narrative}
GDPR:ART9 PHI:{hash8} TS:{epoch}
```

## Szenario-Codes

| Code | Vollname | ICD-10-Cluster |
|------|----------|----------------|
| STEMI | ST-Elevation Myocardial Infarction | I21.x, I22.x |
| SEPSIS | Sepsis / Septischer Schock | A40.x, A41.x |
| STROKE | Ischämischer Schlaganfall | I63.x, I64 |
| ANAPH | Anaphylaxie | T78.2, T80.5 |
| DM-HYPO | Diabetische Hypoglykämie | E10.64, E11.64 |
| TRAUMA | Polytrauma | S00-T14 |
| HF-DECOMP | Dekompensierte Herzinsuffizienz | I50.x |
| ACS | Akutes Koronarsyndrom (NSTEMI/UA) | I20.0, I21.4 |

## Vitalzeichen-Keys

| Key | LOINC | Einheit | Kritisch wenn |
|-----|-------|---------|---------------|
| hr | 8867-4 | /min | > 150 oder < 40 |
| sbp | 8480-6 | mmHg | < 90 oder > 220 |
| dbp | 8462-4 | mmHg | < 60 oder > 130 |
| spo2 | 59408-5 | % | < 90 |
| rr | 9279-1 | /min | > 30 oder < 8 |
| temp | 8310-5 | °C | < 35 oder > 40 |
| gcs | — | pts | < 9 |
| map | 55284-4* | mmHg | < 65 |

## Labor-Keys

| Key | LOINC | Einheit | P1-Grenze |
|-----|-------|---------|-----------|
| hs_tni | 89579-7 | ng/L | > 52 |
| ckmb | 13969-1 | µg/L | > 10 |
| lactate | 2519-7 | mmol/L | > 4.0 |
| pct | 33959-8 | µg/L | > 10 |
| crp | 1988-5 | mg/L | — |
| glucose | 15074-8 | mmol/L | < 2.5 |
| egfr | 62238-1 | ml/min/1.73m² | < 15 |
| hb | 718-7 | g/dL | < 7.0 |
| inr | 34714-6 | — | > 3.0 |

## Kritikalitäts-Flags

| Flag | Bedeutung | Interpretation-Code |
|------|-----------|---------------------|
| ↑↑ | Kritisch erhöht | HH |
| ↑ | Erhöht | H |
| n | Normal | N |
| ↓ | Erniedrigt | L |
| ↓↓ | Kritisch erniedrigt | LL |

## Allergie-Schweregrade (WAO/AWMF)

| Grad | Symptome | CompText Code |
|------|----------|---------------|
| I | Haut (Urtikaria) | SEV:I |
| II | Moderate systemische Reaktion | SEV:II |
| III | Lebensbedrohliche Reaktion | SEV:III |
| IV | Herzstillstand | SEV:IV |

## Beispiel — Vollständiger STEMI Frame

```
CT:v5 SC:STEMI TRI:P1
VS[hr:118 sbp:82↓↓ spo2:91↓]
LAB[hsTnI:4847ng/L↑↑ ckmb:48.7µg/L↑↑]
ALG:Jodkontrastmittel SEV:II KI:[V08,V09]
RX:Aspirin ATC:1191 DOSE:500mg FREQ:1x iv
ICD:[I21.09]
CTX:Ak. transm. MI VW KS; KM-ALG Grad II; Erstvorstellung
GDPR:ART9 PHI:3f8a1c2d TS:1710509000
```

**Token-Count (cl100k_base)**: 89 Tokens

Verglichen mit originalem FHIR JSON: **1.847 Tokens** → **Reduktion: 95.2%**
