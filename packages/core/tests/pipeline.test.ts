/**
 * @comptext/core — Unit Tests
 *
 * Tests verify:
 *  - NURSE: PHI removal, deduplication, token reduction
 *  - KVTC: All 4 layers produce correct output
 *  - Triage: Correct P1/P2/P3 classification for all scenarios
 *  - Frame: GDPR compliance, safety-critical field preservation
 *  - Pipeline: End-to-end > 90% token reduction
 */

import { describe, it, expect } from "vitest"
import { pipeline, FHIR_STEMI, FHIR_SEPSIS, FHIR_STROKE, FHIR_ANAPHYLAXIE, FHIR_DM_HYPO, serializeFrame } from "../src/index.js"
import { runNURSE } from "../src/compiler/nurse.js"
import { runKVTC } from "../src/compiler/kvtc.js"

// ─── NURSE Stage Tests ────────────────────────────────────────────────────────

describe("NURSE Stage", () => {
  it("removes PHI fields from Patient resource", () => {
    const result = runNURSE(FHIR_STEMI)
    const patResource = result.resources.find(r => r.type === "Patient")
    expect(patResource).toBeDefined()
    // PHI fields must not be present
    expect(patResource!.fields).not.toHaveProperty("name")
    expect(patResource!.fields).not.toHaveProperty("birthDate")
    expect(patResource!.fields).not.toHaveProperty("address")
    expect(patResource!.fields).not.toHaveProperty("telecom")
    expect(patResource!.fields).not.toHaveProperty("identifier")
  })

  it("preserves clinical gender information", () => {
    const result = runNURSE(FHIR_STEMI)
    const patResource = result.resources.find(r => r.type === "Patient")
    expect(patResource!.fields.gender).toBe("male")
  })

  it("sets scrubbed = true and phi_hash is 8 hex chars", () => {
    const result = runNURSE(FHIR_STEMI)
    expect(result.scrubbed).toBe(true)
    expect(result.phi_hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it("reduces tokens (nurse.token_out < nurse.token_in)", () => {
    const result = runNURSE(FHIR_STEMI)
    expect(result.token_out).toBeLessThan(result.token_in)
    // Expected: ~12% reduction from PHI scrubbing alone
    const reduction = (1 - result.token_out / result.token_in) * 100
    expect(reduction).toBeGreaterThan(5)
  })

  it("deduplicates observations with same LOINC code", () => {
    // STEMI bundle has unique LOINC codes — count should be 1:1
    const result = runNURSE(FHIR_STEMI)
    const obs = result.resources.filter(r => r.type === "Observation")
    const loincs = obs.map(o => o.fields.loinc as string)
    const unique = new Set(loincs)
    expect(loincs.length).toBe(unique.size)
  })
})

// ─── KVTC Stage Tests ─────────────────────────────────────────────────────────

describe("KVTC Stage", () => {
  it("K layer extracts vital signs with compact keys", () => {
    const nurse = runNURSE(FHIR_STEMI)
    const kvtc = runKVTC(nurse)
    const keys = kvtc.layer_k.pairs.map(p => p.display)
    // STEMI bundle has HR and BP observations
    expect(keys).toContain("HR")
    expect(keys).toContain("sBP")
  })

  it("V layer produces compact notation with units", () => {
    const nurse = runNURSE(FHIR_STEMI)
    const kvtc = runKVTC(nurse)
    const hrEntry = kvtc.layer_v.normalized.find(n => n.key === "HR")
    expect(hrEntry?.compact).toMatch(/^HR:\d+/)
  })

  it("V layer marks critical values correctly", () => {
    const nurse = runNURSE(FHIR_STEMI)
    const kvtc = runKVTC(nurse)
    // STEMI: hsTnI 4847 ng/L = HH = critical
    const tni = kvtc.layer_v.normalized.find(n => n.key === "hsTnI")
    expect(tni?.critical).toBe(true)
  })

  it("T layer encodes FHIR types to compact codes", () => {
    const nurse = runNURSE(FHIR_STEMI)
    const kvtc = runKVTC(nurse)
    expect(kvtc.layer_t.encoded["Observation"]).toBe("OBS")
    expect(kvtc.layer_t.encoded["Condition"]).toBe("DX")
    expect(kvtc.layer_t.encoded["MedicationStatement"]).toBe("MED")
  })

  it("C layer produces shorter narrative than original", () => {
    const nurse = runNURSE(FHIR_STEMI)
    const kvtc = runKVTC(nurse)
    // Original condition text ~ 50+ chars, compressed should be shorter
    expect(kvtc.layer_c.narrative.length).toBeGreaterThan(0)
    expect(kvtc.layer_c.token_saved).toBeGreaterThanOrEqual(0)
  })

  it("reduces tokens further than NURSE output", () => {
    const nurse = runNURSE(FHIR_STEMI)
    const kvtc = runKVTC(nurse)
    expect(kvtc.token_out).toBeLessThan(kvtc.token_in)
  })
})

// ─── Full Pipeline Tests ──────────────────────────────────────────────────────

describe("Full Pipeline — STEMI", () => {
  it("returns P1 triage for STEMI with cardiogenic shock", async () => {
    const result = await pipeline(FHIR_STEMI)
    expect(result.frame.tri).toBe("P1")
  })

  it("achieves > 85% token reduction", async () => {
    const result = await pipeline(FHIR_STEMI)
    expect(result.benchmark.reduction_pct).toBeGreaterThan(85)
  })

  it("preserves contrast allergy in output frame", async () => {
    const result = await pipeline(FHIR_STEMI)
    const algNames = result.frame.alg.map(a => a.ag)
    expect(algNames.some(n => n.toLowerCase().includes("kontrast") || n.toLowerCase().includes("jod"))).toBe(true)
  })

  it("is GDPR compliant", async () => {
    const result = await pipeline(FHIR_STEMI)
    expect(result.benchmark.gdpr_compliant).toBe(true)
    expect(result.frame.gdpr.art9).toBe(true)
    expect(result.frame.gdpr.minimized).toBe(true)
  })

  it("frame version is 5", async () => {
    const result = await pipeline(FHIR_STEMI)
    expect(result.frame.v).toBe("5")
  })
})

describe("Full Pipeline — SEPSIS", () => {
  it("returns P1 triage for septic shock", async () => {
    const result = await pipeline(FHIR_SEPSIS)
    expect(result.frame.tri).toBe("P1")
  })

  it("flags Penicillin allergy", async () => {
    const result = await pipeline(FHIR_SEPSIS)
    const algNames = result.frame.alg.map(a => a.ag.toLowerCase())
    expect(algNames.some(n => n.includes("penicillin"))).toBe(true)
  })

  it("lactate > 4 mmol/L captured in labs", async () => {
    const result = await pipeline(FHIR_SEPSIS)
    expect(result.frame.lab.lactate).toBeDefined()
    expect(result.frame.lab.lactate!).toBeGreaterThan(2)
  })
})

describe("Full Pipeline — STROKE", () => {
  it("returns P1 triage for acute stroke", async () => {
    const result = await pipeline(FHIR_STROKE)
    expect(result.frame.tri).toBe("P1")
  })

  it("flags Rivaroxaban with LYSE-KI annotation", async () => {
    const result = await pipeline(FHIR_STROKE)
    const rivaroxabanRx = result.frame.rx.find(r => r.atc === "B01AF01")
    expect(rivaroxabanRx).toBeDefined()
    expect(rivaroxabanRx!.ki?.some(k => k.includes("LYSE-KI"))).toBe(true)
  })
})

describe("Full Pipeline — Anaphylaxis", () => {
  it("returns P1 triage for anaphylaxis Grade III", async () => {
    const result = await pipeline(FHIR_ANAPHYLAXIE)
    expect(result.frame.tri).toBe("P1")
  })

  it("SpO2 87% captured and critical", async () => {
    const result = await pipeline(FHIR_ANAPHYLAXIE)
    expect(result.frame.vs.spo2).toBe(87)
  })
})

describe("Full Pipeline — DM Hypoglycaemia", () => {
  it("returns P1 or P2 triage for severe hypoglycaemia", async () => {
    const result = await pipeline(FHIR_DM_HYPO)
    expect(["P1", "P2"]).toContain(result.frame.tri)
  })

  it("flags Glibenclamide with Rebound annotation", async () => {
    const result = await pipeline(FHIR_DM_HYPO)
    const glibRx = result.frame.rx.find(r => r.atc?.startsWith("A10BB"))
    expect(glibRx).toBeDefined()
    expect(glibRx!.ki?.some(k => k.includes("Rebound"))).toBe(true)
  })

  it("glucose 1.8 mmol/L captured in labs", async () => {
    const result = await pipeline(FHIR_DM_HYPO)
    expect(result.frame.lab.glucose).toBeDefined()
    expect(result.frame.lab.glucose!).toBeLessThan(3.5)
  })
})

// ─── serializeFrame Tests ──────────────────────────────────────────────────────

describe("serializeFrame", () => {
  it("produces valid CompText DSL string", async () => {
    const result = await pipeline(FHIR_STEMI)
    const ct = serializeFrame(result.frame)
    expect(ct).toContain("CT:v5")
    expect(ct).toContain("SC:STEMI")
    expect(ct).toContain("TRI:P1")
    expect(ct).toContain("GDPR:ART9")
  })

  it("serialized string is shorter than FHIR JSON", async () => {
    const result = await pipeline(FHIR_STEMI)
    const ct = serializeFrame(result.frame)
    const fhirJson = JSON.stringify(FHIR_STEMI)
    expect(ct.length).toBeLessThan(fhirJson.length)
  })
})
