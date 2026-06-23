import { describe, it, expect } from "vitest";
import { createSmsClient } from "../src/client.js";
import { createSenderRegistry } from "../src/sender-registry.js";
import { createMemoryAdapter } from "../src/adapters/memory.js";
import { SmsProviderError } from "../src/errors.js";

const noSleep = async () => {};

function failing(name: string) {
  return createMemoryAdapter({
    name,
    onSend: () => {
      throw new SmsProviderError("down", name, "transient_provider_error");
    },
  });
}

describe("safe fallback behavior", () => {
  it("does NOT fall back to a different number by default", async () => {
    const twilio = failing("twilio");
    const telnyx = createMemoryAdapter({ name: "telnyx" });
    const registry = createSenderRegistry([
      { id: "a", phoneNumber: "+15555550100", provider: "twilio" },
      { id: "b", phoneNumber: "+15555550200", provider: "telnyx" },
    ]);
    const client = createSmsClient({
      adapters: [twilio, telnyx],
      senderRegistry: registry,
      retry: { attempts: 1, sleep: noSleep },
      fallback: { senders: ["b"] }, // present but allowSenderFallback defaults false
    });
    await expect(client.send({ to: "+15555559999", body: "hi", from: "a" })).rejects.toThrowError(/down/);
    expect(telnyx.sent).toHaveLength(0);
  });

  it("falls back to another sender only when explicitly allowed", async () => {
    const twilio = failing("twilio");
    const telnyx = createMemoryAdapter({ name: "telnyx" });
    const registry = createSenderRegistry([
      { id: "a", phoneNumber: "+15555550100", provider: "twilio" },
      { id: "b", phoneNumber: "+15555550200", provider: "telnyx" },
    ]);
    const client = createSmsClient({
      adapters: [twilio, telnyx],
      senderRegistry: registry,
      retry: { attempts: 1, sleep: noSleep },
    });
    const r = await client.send(
      { to: "+15555559999", body: "hi", from: "a" },
      { allowSenderFallback: true, fallbackSenders: ["b"] },
    );
    expect(r.provider).toBe("telnyx");
    expect(r.from).toBe("+15555550200"); // different number, as expected for cross-provider fallback
  });

  it("never falls back to the same sender (same number)", async () => {
    const twilio = failing("twilio");
    const registry = createSenderRegistry([{ id: "a", phoneNumber: "+15555550100", provider: "twilio" }]);
    const client = createSmsClient({
      adapters: [twilio],
      senderRegistry: registry,
      retry: { attempts: 1, sleep: noSleep },
    });
    await expect(
      client.send({ to: "+15555559999", body: "hi", from: "a" }, { allowSenderFallback: true, fallbackSenders: ["a"] }),
    ).rejects.toThrowError(/down/);
  });
});
