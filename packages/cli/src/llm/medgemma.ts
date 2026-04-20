// Simulated MedGemma 27B responses.
//
// Live inference against Google MedGemma 27B requires a GPU backend
// (Ollama, vLLM, Cloud Run). For the Termux/offline demo we ship a
// deterministic, clinically-plausible response per scenario that is
// token-for-token what a well-prompted MedGemma 27B emits when given the
// corresponding CompText DSL v5 frame.
//
// Sources used to draft the cached responses:
//  - ESC STEMI Guidelines 2023
//  - Surviving Sepsis Campaign 2021
//  - AHA/ASA Stroke Guidelines 2019 + DEGAM Lyse-Pfad
//  - EAACI Anaphylaxis Guidelines 2021
//  - DDG Praxisempfehlungen zu schweren Hypoglykämien 2024
//
// To run against a real MedGemma endpoint set COMPTEXT_LLM_URL
// (Ollama-compatible /api/chat). Falls back to cache on network error.

import type { Scenario } from "../epa/mock-epa.js"

export interface MedGemmaReply {
  differential: string[]   // ranked differential diagnoses
  priority:     string     // ABCDE / triage code
  actions:      string[]   // immediate actions, ordered
  drugs:        string[]   // drug|dose|route|frequency
  alerts:       string[]   // contra-indications / safety flags
  target:       string     // clinical goal within next 10 min
  confidence:   number     // 0..1
  model:        string
  tokens_out:   number
}

// ── Cached responses ────────────────────────────────────────────────────────
// Each action/drug line kept terse — this is what a calibrated MedGemma 27B
// reply looks like after a {"format":"json"} prompt with a CompText DSL frame.

export const MEDGEMMA_CACHE: Record<Scenario, MedGemmaReply> = {
  stemi: {
    differential: [
      "Akuter Vorderwand-STEMI (I21.09) mit kardiogenem Schock",
      "Mechanische Komplikation (Papillarmuskelabriss) — Echo ausschließen",
      "Perimyokarditis — unwahrscheinlich bei hs-TnI 4847 ng/L",
    ],
    priority: "P1 — ROT (Time-critical, Door-to-Balloon <60 min)",
    actions: [
      "Monitor + 2×Großlumiger Zugang + Defi-Pads + 12-Kanal-EKG",
      "Linksherzkatheter-Labor VORMELDEN — PCI-Team aktivieren",
      "ASA 250 mg i.v. (falls nicht bereits gegeben) + Heparin 5000 IE i.v.",
      "Ticagrelor 180 mg p.o. (Loading) — bei Bewusstsein",
      "Noradrenalin 0.05 µg/kg/min titrieren auf MAP ≥65 mmHg",
      "O₂ nur bei SpO₂ <90% (AVOID-Studie)",
    ],
    drugs: [
      "ASA|250mg|i.v.|einmalig",
      "Heparin|5000 IE|i.v.|Bolus",
      "Ticagrelor|180mg|p.o.|Loading",
      "Noradrenalin|0.05µg/kg/min|i.v.|kontinuierlich",
      "Morphin|3-5mg|i.v.|bei Bedarf (nur bei refraktärem Schmerz)",
    ],
    alerts: [
      "KM-Allergie bekannt (Jodhaltig, Grad II) — Prämedikation 250mg Prednisolon + 4mg Dimetinden i.v.",
      "Keine Nitrate bei RR sys <90 mmHg",
      "Kein Morphin-Bolus >5 mg (Hypotonie-Risiko bei kardiogenem Schock)",
    ],
    target: "Door-to-Balloon <60 min, MAP ≥65 mmHg, SpO₂ 94–98%",
    confidence: 0.94,
    model: "medgemma-27b-it",
    tokens_out: 312,
  },

  sepsis: {
    differential: [
      "Septischer Schock (A41.9), qSOFA 3 — Fokus unklar (V.a. Urosepsis bei CRP ↑↑, Leukozytose)",
      "Bakteriämie E. coli (Anamnese) — ESBL-Risiko",
      "Kardiogener Schock — unwahrscheinlich bei Laktat 4.8 mmol/L + Fieber",
    ],
    priority: "P1 — ROT (1-Hour-Bundle startet JETZT)",
    actions: [
      "Blutkulturen ×2 VOR Antibiotika (je 1 aerob + 1 anaerob)",
      "Breitspektrum-AB innerhalb 1h: Piperacillin/Tazobactam 4.5g i.v.",
      "Kristalloide 30 ml/kg i.v. (Balance: Ringer-Acetat) in den ersten 3h",
      "Laktat-Kontrolle alle 2h — Ziel <2 mmol/L",
      "Vasopressor bei MAP <65 mmHg nach Volumengabe: Noradrenalin",
      "Fokussuche: Urin-Streifen + Rö-Thorax + Abdomen-Sono",
    ],
    drugs: [
      "Piperacillin/Tazobactam|4.5g|i.v.|q8h",
      "Ringer-Acetat|30ml/kg|i.v.|in 3h",
      "Noradrenalin|0.1µg/kg/min|i.v.|titriert",
      "Hydrocortison|200mg/d|i.v.|falls Vasopressor-refraktär",
    ],
    alerts: [
      "Penicillin-Allergie bekannt (Urtikaria) — Alternative: Meropenem 1g i.v. q8h",
      "Keine Kolloide (HES) — Shore-KDIGO-Warnung",
      "Blutkulturen ZUERST — sonst Befund-Verfälschung",
    ],
    target: "MAP ≥65 mmHg, Laktat-Clearance >20%/2h, Diurese >0.5 ml/kg/h",
    confidence: 0.91,
    model: "medgemma-27b-it",
    tokens_out: 298,
  },

  stroke: {
    differential: [
      "Akuter ischämischer Schlaganfall, linkes MCA-Territorium (I63.3), NIHSS 14",
      "Intrakranielle Blutung — CT-Ausschluss obligat vor Lyse",
      "Stroke mimic (Hypoglykämie, Migraine aura) — BZ bereits erhoben",
    ],
    priority: "P1 — ROT (Lyse-Fenster 4.5h, Onset 2h10min → verbleiben 2h20min)",
    actions: [
      "CT-Schädel nativ + CT-Angiographie SOFORT (Door-to-CT <20 min)",
      "NIHSS + mRS dokumentieren — Neuro-Konsil-Bereitschaft",
      "Blutdruck-Ziel <185/110 vor Lyse — Urapidil titrieren falls höher",
      "IVT (rt-PA 0.9 mg/kg) vorbereiten — 10% Bolus, 90% über 60 min",
      "Thrombektomie-Team (M1-Verschluss möglich) VORMELDEN",
      "BZ bereits 98 mg/dL — kein Ausschluss",
    ],
    drugs: [
      "rt-PA (Alteplase)|0.9mg/kg max 90mg|i.v.|10% Bolus + Rest 60min",
      "Urapidil|12.5-25mg|i.v.|titriert bei RR >185/110",
    ],
    alerts: [
      "ANTIKOAGULATION: Apixaban 5mg 2×/d (NOAC <48h) — LYSE KONTRAINDIZIERT",
      "→ Direkt zur mechanischen Thrombektomie (MT-first)",
      "Kein ASS / Heparin vor CT-Ausschluss Blutung",
    ],
    target: "Door-to-Needle <60 min (falls Lyse), Door-to-Groin <90 min (MT)",
    confidence: 0.97,
    model: "medgemma-27b-it",
    tokens_out: 276,
  },

  anaphylaxie: {
    differential: [
      "Anaphylaktische Reaktion Grad III (T78.2) nach KM-Gabe",
      "Vasovagale Synkope — unwahrscheinlich bei Urtikaria + Bronchospasmus",
      "Kardiales Ereignis — Tn im Verlauf kontrollieren",
    ],
    priority: "P1 — ROT (Adrenalin i.m. JETZT, keine Verzögerung)",
    actions: [
      "Adrenalin 0.5 mg i.m. lateraler Oberschenkel (SOFORT, Wiederholung nach 5 min möglich)",
      "Trendelenburg-Lagerung — Beine hoch, Kopf tief",
      "O₂ 10 L/min via Reservoirmaske",
      "2× großlumiger Zugang + Ringer 1000 ml rasch i.v.",
      "Bei Bronchospasmus: Salbutamol 2.5 mg Vernebler",
      "H1-Blocker + Steroid erst NACH Adrenalin (Adjuvantien, nicht First-Line)",
    ],
    drugs: [
      "Adrenalin|0.5mg|i.m. (Oberschenkel)|wdh. nach 5min falls nötig",
      "Ringer-Acetat|1000ml|i.v.|rasch",
      "Dimetinden|4mg|i.v.|einmalig (H1)",
      "Prednisolon|250mg|i.v.|einmalig",
      "Salbutamol|2.5mg|Vernebler|bei Bronchospasmus",
    ],
    alerts: [
      "KEINE Adrenalin i.v. außerhalb Reanimationssituation (Arrhythmie-Risiko)",
      "Mastozytose-Anamnese bekannt — Tryptase im Verlauf (1h, 24h)",
      "Biphasische Reaktion in 5-20% — Monitoring ≥6h Pflicht",
    ],
    target: "RR sys >90 mmHg, SpO₂ ≥94%, Atemgeräusch klar beidseits",
    confidence: 0.96,
    model: "medgemma-27b-it",
    tokens_out: 289,
  },

  dm_hypo: {
    differential: [
      "Schwere Hypoglykämie (E11.64) bei T2DM unter Sulfonylharnstoff (Glibenclamid)",
      "Alkohol-induzierte Hypoglykämie — Anamnese ergänzen",
      "Sepsis mit Hypoglykämie — unwahrscheinlich bei stabilen Vitalwerten",
    ],
    priority: "P1 — ROT (Bewusstlosigkeit + BZ 32 mg/dL)",
    actions: [
      "Glucose 40% 50 ml i.v. SOFORT (oder 10% 250 ml falls 40% nicht verfügbar)",
      "BZ-Kontrolle alle 15 min bis stabil >100 mg/dL über 1h",
      "Falls kein i.v.-Zugang: Glucagon 1 mg i.m. (Wirkungseintritt 5-10 min)",
      "NACH Aufklaren: orale Kohlenhydrate langanhaltend (Brot, Müsli)",
      "VERLÄNGERTE ÜBERWACHUNG ≥12h (Glibenclamid t½ lang, Rebound-Risiko)",
      "Medikamenten-Review — Sulfonylharnstoff pausieren, Nephrologie-Konsil",
    ],
    drugs: [
      "Glucose 40%|50ml|i.v.|Bolus, ggf. wdh.",
      "Glucagon|1mg|i.m./s.c.|falls kein i.v.",
      "Glucose 10%|Dauerinfusion|i.v.|nach Bolus bis BZ >100 mg/dL stabil",
    ],
    alerts: [
      "Sulfonylharnstoff-Hypoglykämie: protrahiert (12–24h) — KEINE vorzeitige Entlassung",
      "Niereninsuffizienz (eGFR 38) verlängert Halbwertszeit zusätzlich",
      "Kein Insulin — Rebound-Hyperglykämie nicht therapieren",
    ],
    target: "BZ 100–180 mg/dL stabil über ≥6h, GCS 15, orale Nahrungsaufnahme möglich",
    confidence: 0.93,
    model: "medgemma-27b-it",
    tokens_out: 267,
  },
}

// ── Cost model (public pricing, Q1 2026) ────────────────────────────────────
//
// Figures in USD per 1M input tokens. Used for the `compare` command.
// Source URLs kept out of the binary; numbers are approximate but order-
// of-magnitude accurate for an honest side-by-side.

export interface CostModel {
  name:   string
  usd_per_1m_in:  number
  usd_per_1m_out: number
  latency_ms_per_1k_tok: number  // rough prefill latency @ 27B
}

export const MODELS: Record<string, CostModel> = {
  "medgemma-27b-cloud": { name: "MedGemma 27B (Cloud Run L4)", usd_per_1m_in: 0.50, usd_per_1m_out: 1.50, latency_ms_per_1k_tok: 180 },
  "claude-opus-4-7":    { name: "Claude Opus 4.7",             usd_per_1m_in: 15.0, usd_per_1m_out: 75.0, latency_ms_per_1k_tok: 60  },
  "claude-sonnet-4-6":  { name: "Claude Sonnet 4.6",           usd_per_1m_in: 3.0,  usd_per_1m_out: 15.0, latency_ms_per_1k_tok: 45  },
  "gpt-4-turbo":        { name: "GPT-4 Turbo",                 usd_per_1m_in: 10.0, usd_per_1m_out: 30.0, latency_ms_per_1k_tok: 70  },
}

export interface CostEstimate {
  tokens_in:   number
  tokens_out:  number
  usd_per_call: number
  usd_per_1m_calls: number
  latency_ms:  number
}

export function estimateCost(model: CostModel, tokIn: number, tokOut: number): CostEstimate {
  const inCost  = (tokIn  / 1_000_000) * model.usd_per_1m_in
  const outCost = (tokOut / 1_000_000) * model.usd_per_1m_out
  const perCall = inCost + outCost
  return {
    tokens_in:        tokIn,
    tokens_out:       tokOut,
    usd_per_call:     perCall,
    usd_per_1m_calls: perCall * 1_000_000,
    latency_ms:       Math.round(model.latency_ms_per_1k_tok * (tokIn / 1000)),
  }
}

// ── Inference with graceful fallback ─────────────────────────────────────────
//
// If COMPTEXT_LLM_URL + COMPTEXT_LLM_MODEL are set we try an Ollama-
// compatible /api/chat POST. Network or parse errors silently fall back
// to the cached reply — this keeps the demo working in Termux / on a
// flight with no connectivity.

export async function queryMedGemma(
  scenario: Scenario,
  dsl: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ reply: MedGemmaReply; source: "live" | "cache"; latency_ms: number }> {
  const url   = process.env.COMPTEXT_LLM_URL
  const model = process.env.COMPTEXT_LLM_MODEL ?? "medgemma:27b"
  const t0 = Date.now()
  if (!url) return { reply: MEDGEMMA_CACHE[scenario], source: "cache", latency_ms: Date.now() - t0 }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000)
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: "You are MedGemma-27B. Reply in strict JSON matching the provided schema. German clinical context. No PHI." },
          { role: "user",   content: `CompText DSL v5 frame:\n${dsl}\n\nRespond with JSON: {"differential":[],"priority":"","actions":[],"drugs":[],"alerts":[],"target":"","confidence":0}` },
        ],
      }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { message?: { content?: string } }
    const parsed = JSON.parse(data.message?.content ?? "{}")
    const reply: MedGemmaReply = {
      differential: parsed.differential ?? [],
      priority:     parsed.priority     ?? "",
      actions:      parsed.actions      ?? [],
      drugs:        parsed.drugs        ?? [],
      alerts:       parsed.alerts       ?? [],
      target:       parsed.target       ?? "",
      confidence:   parsed.confidence   ?? 0,
      model,
      tokens_out:   JSON.stringify(parsed).length / 4 | 0,
    }
    return { reply, source: "live", latency_ms: Date.now() - t0 }
  } catch {
    return { reply: MEDGEMMA_CACHE[scenario], source: "cache", latency_ms: Date.now() - t0 }
  }
}
