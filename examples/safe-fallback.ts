/**
 * Safe sender fallback — falling back changes the visible "from" number, so it
 * is opt-in. Here the primary (twilio) sender fails and we fall back to a
 * different owned number on telnyx. No credentials needed (memory adapters).
 *
 *   npx tsx examples/safe-fallback.ts
 */
import { createSmsClient, createSenderRegistry, SmsProviderError } from "@mogilventures/sms-sdk";
import { createMemoryAdapter } from "@mogilventures/sms-sdk/testing";

// Primary always fails with a transient error.
const twilio = createMemoryAdapter({
  name: "twilio",
  onSend: () => {
    throw new SmsProviderError("twilio outage (simulated)", "twilio", "transient_provider_error");
  },
});
const telnyx = createMemoryAdapter({ name: "telnyx" });

const senders = createSenderRegistry([
  { id: "primary", phoneNumber: "+15550101000", provider: "twilio" },
  { id: "backup", phoneNumber: "+15550102000", provider: "telnyx" },
]);

const sms = createSmsClient({
  adapters: [twilio, telnyx],
  senderRegistry: senders,
  retry: { attempts: 1 },
});

// Without allowSenderFallback this would throw — a number can't move providers.
const result = await sms.send(
  { to: "+15550109999", body: "Hi", from: "primary", campaign: { id: "alerts" } },
  { allowSenderFallback: true, fallbackSenders: ["backup"] },
);

console.log("sent via:", result.provider, "from:", result.from); // telnyx, +15550102000
