import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

describe("CLI", () => {
  it("lists adapters offline", async () => {
    const result = await runCli(["adapters"], {});
    expect(result.code).toBe(0);
    const rows = JSON.parse(result.out);
    expect(rows.map((r: { name: string }) => r.name).sort()).toEqual(["memory", "plivo", "sns", "telnyx", "twilio"]);
  });

  it("validates messages and surfaces compliance errors", async () => {
    const ok = await runCli(["validate", "--to", "+15559999999", "--body", "hello"], {});
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("valid: true");

    const blocked = await runCli(["validate", "--to", "+15559999999", "--body", "hello", "--require-consent"], {});
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain("Consent is required");
  });

  it("dry-runs test-send through memory adapter", async () => {
    const result = await runCli(["test-send", "--from", "+15550100100", "--to", "+15559999999", "--body", "dry run"], {});
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.out);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.result.provider).toBe("memory");
  });

  it("parses inbound payloads offline", async () => {
    const result = await runCli([
      "inbound-parse",
      "--provider",
      "twilio",
      "--json",
      JSON.stringify({ MessageSid: "SM_IN", From: "+15559999999", To: "+15550100100", Body: "STOP" }),
    ], {});
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.out);
    expect(parsed).toMatchObject({ provider: "twilio", from: "+15559999999", to: "+15550100100", body: "STOP" });
  });
});
