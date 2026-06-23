import { describe, it, expect } from "vitest";
import { createSmsClient } from "../src/client.js";
import { createSenderRegistry } from "../src/sender-registry.js";
import { createMemoryAdapter } from "../src/adapters/memory.js";

function setup() {
  const twilio = createMemoryAdapter({ name: "twilio" });
  const telnyx = createMemoryAdapter({ name: "telnyx" });
  const registry = createSenderRegistry([
    { id: "marketing", phoneNumber: "+15555550100", provider: "twilio" },
    { id: "support", phoneNumber: "+15555550200", provider: "telnyx", alias: "help" },
  ]);
  const client = createSmsClient({ adapters: [twilio, telnyx], senderRegistry: registry });
  return { client, twilio, telnyx };
}

describe("routing by phone number / sender", () => {
  it("routes by owned sender id to its owning provider", async () => {
    const { client, twilio, telnyx } = setup();
    const r = await client.send({ to: "+15555559999", body: "hi", from: "marketing" });
    expect(r.provider).toBe("twilio");
    expect(r.from).toBe("+15555550100");
    expect(twilio.sent).toHaveLength(1);
    expect(telnyx.sent).toHaveLength(0);
  });

  it("routes by phone number selector", async () => {
    const { client, telnyx } = setup();
    const r = await client.send({ to: "+15555559999", body: "hi", from: "+15555550200" });
    expect(r.provider).toBe("telnyx");
    expect(telnyx.sent[0]?.from).toBe("+15555550200");
  });

  it("routes by alias via message.sender", async () => {
    const { client, telnyx } = setup();
    const r = await client.send({ to: "+15555559999", body: "hi", sender: "help" });
    expect(r.provider).toBe("telnyx");
  });

  it("uses defaultSender when none given", async () => {
    const twilio = createMemoryAdapter({ name: "twilio" });
    const registry = createSenderRegistry([{ id: "d", phoneNumber: "+15555550100", provider: "twilio" }]);
    const client = createSmsClient({ adapters: [twilio], senderRegistry: registry, defaultSender: "d" });
    const r = await client.send({ to: "+15555559999", body: "hi" });
    expect(r.from).toBe("+15555550100");
  });

  it("lists adapter capabilities", () => {
    const { client } = setup();
    const caps = client.listAdapterCapabilities();
    expect(Object.keys(caps).sort()).toEqual(["telnyx", "twilio"]);
    expect(caps.twilio?.sms).toBe(true);
  });
});
