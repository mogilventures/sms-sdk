import { describe, it, expect } from "vitest";
import { createSenderRegistry, SenderRegistry } from "../src/sender-registry.js";
import { SmsSdkError } from "../src/errors.js";

describe("SenderRegistry", () => {
  it("resolves by id, alias, and phone number", () => {
    const reg = createSenderRegistry([
      { id: "support", phoneNumber: "+15555550100", provider: "twilio", alias: "help" },
    ]);
    expect(reg.resolve("support").id).toBe("support");
    expect(reg.resolve("help").id).toBe("support");
    expect(reg.resolve("+15555550100").id).toBe("support");
    expect(reg.getByPhone("+15555550100")?.provider).toBe("twilio");
  });

  it("enforces one phone number -> one provider", () => {
    const reg = new SenderRegistry([{ id: "a", phoneNumber: "+15555550100", provider: "twilio" }]);
    expect(() => reg.register({ id: "b", phoneNumber: "+15555550100", provider: "telnyx" })).toThrowError(
      /only live with one provider/,
    );
    try {
      reg.register({ id: "c", phoneNumber: "+15555550100", provider: "telnyx" });
    } catch (e) {
      expect((e as SmsSdkError).code).toBe("duplicate_sender_binding");
    }
  });

  it("rejects duplicate ids and aliases", () => {
    const reg = new SenderRegistry([{ id: "a", phoneNumber: "+15555550100", provider: "twilio", alias: "x" }]);
    expect(() => reg.register({ id: "a", phoneNumber: "+15555550101", provider: "twilio" })).toThrowError(
      /already registered/,
    );
    expect(() => reg.register({ id: "b", phoneNumber: "+15555550102", provider: "twilio", alias: "x" })).toThrowError(
      /alias/,
    );
  });

  it("throws sender_not_found on unknown selector", () => {
    const reg = new SenderRegistry();
    expect(() => reg.resolve("nope")).toThrowError(/No owned sender/);
  });
});
