import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts", "src/fhir.ts", "src/benchmarks.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
})
