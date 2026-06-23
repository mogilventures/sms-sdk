import { describe, it, expect } from "vitest";
import { a2pcheckReadiness, type A2PCheckOptions } from "../src/plugins/a2pcheck.js";
import { SmsComplianceError } from "../src/errors.js";
import type { SmsMessage } from "../src/types.js";

const ready: SmsMessage = {
  to: "+15550109999",
  body: "Your code is 123456. Reply STOP to opt out, HELP for help.",
  campaign: { id: "login_otp", brand: "Example Inc" },
  consent: { granted: true, source: "signup" },
  from: "login-otp",
};

const codes = (msg: SmsMessage, opts: A2PCheckOptions = {}) =>
  a2pcheckReadiness(opts).checkMessage(msg).findings.map((f) => f.code);

describe("a2pcheckReadiness", () => {
  it("passes a fully-formed message with no blocks", () => {
    const report = a2pcheckReadiness({ requireOptOutLanguage: true }).checkMessage(ready);
    expect(report.blocked).toBe(false);
    expect(report.ok).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it("warns on missing campaign id and consent", () => {
    const c = codes({ to: "+15550109999", body: "hi", from: "x" });
    expect(c).toContain("missing_campaign_id");
    expect(c).toContain("missing_consent");
  });

  it("blocks an invalid recipient and empty body regardless of config", () => {
    const report = a2pcheckReadiness().checkMessage({ to: "not-a-number", body: "  " } as SmsMessage);
    expect(report.blocked).toBe(true);
    const c = report.findings.map((f) => f.code);
    expect(c).toContain("invalid_recipient");
    expect(c).toContain("empty_body");
  });

  it("escalates campaign/consent to block when required", () => {
    const report = a2pcheckReadiness({ requireCampaignId: true, requireConsent: true }).checkMessage({
      to: "+15550109999",
      body: "hi",
      from: "x",
    });
    expect(report.blocked).toBe(true);
    expect(report.findings.filter((f) => f.severity === "block").map((f) => f.code)).toEqual(
      expect.arrayContaining(["missing_campaign_id", "missing_consent"]),
    );
  });

  it("flags link shorteners but not branded domains", () => {
    expect(codes({ ...ready, body: "See https://bit.ly/abc" })).toContain("link_shortener");
    expect(codes({ ...ready, body: "See https://example.com/abc" })).not.toContain("link_shortener");
  });

  it("warns on missing STOP language only when opt-out enforcement is on", () => {
    const msg = { ...ready, body: "Your code is 123456." };
    expect(codes(msg)).not.toContain("missing_stop_language");
    expect(codes(msg, { requireOptOutLanguage: true })).toContain("missing_stop_language");
  });

  it("warns when no sender is resolvable", () => {
    expect(codes({ to: "+15550109999", body: "hi", campaign: { id: "c" }, consent: { granted: true } })).toContain(
      "missing_sender",
    );
  });

  it("assertReady throws SmsComplianceError on a blocking finding", () => {
    const a2p = a2pcheckReadiness({ requireConsent: true });
    expect(() => a2p.assertReady({ to: "+15550109999", body: "hi", from: "x" })).toThrow(SmsComplianceError);
    expect(a2p.assertReady(ready).blocked).toBe(false);
  });
});
