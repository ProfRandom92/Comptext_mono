import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { pipeline, serializeFrame, ALL_FHIR_BUNDLES } from "@comptext/core"
import type { FHIRBundle } from "@comptext/core"

const SCENARIOS = ["stemi", "sepsis", "stroke", "anaphylaxie", "dm_hypo"] as const

const server = new McpServer({ name: "comptext", version: "1.0.0" })

server.tool(
  "comptext_pipeline",
  "Run CompText DSL v5 pipeline on a FHIR R4 bundle. Returns CompTextFrame and DSL string.",
  {
    bundle: z.object({}).passthrough().optional().describe("FHIR R4 Bundle JSON"),
    scenario: z.enum(SCENARIOS).optional().describe("Use a built-in test scenario instead of providing a bundle"),
  },
  async ({ bundle, scenario }) => {
    if (!bundle && !scenario) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either 'bundle' or 'scenario' must be provided." }],
      }
    }

    const input: FHIRBundle = scenario
      ? ALL_FHIR_BUNDLES[scenario]
      : (bundle as FHIRBundle)

    try {
      const result = await pipeline(input)
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            frame: result.frame,
            dsl: serializeFrame(result.frame),
            benchmark: result.benchmark,
          }, null, 2),
        }],
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        isError: true,
        content: [{ type: "text", text: `Pipeline error: ${message}` }],
      }
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
