import { defineConfig } from "tsup";

const libraryEntries = [
  "src/index.ts",
  "src/adapters/twilio.ts",
  "src/adapters/telnyx.ts",
  "src/adapters/plivo.ts",
  "src/adapters/sns.ts",
  "src/adapters/memory.ts",
];

export default defineConfig([
  {
    entry: libraryEntries,
    format: ["esm", "cjs"],
    dts: true,
    clean: false,
    sourcemap: true,
    target: "node18",
    splitting: false,
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: true,
    clean: false,
    sourcemap: true,
    target: "node18",
    splitting: false,
  },
]);
