/**
 * Real Telnyx send. Requires a live credential in the environment:
 *   TELNYX_API_KEY  (optionally TELNYX_MESSAGING_PROFILE_ID)
 *
 *   npx tsx examples/telnyx-send.ts
 */
import { createSmsClient, createSenderRegistry } from "@mogilventures/sms-sdk";
import { createTelnyxAdapter } from "@mogilventures/sms-sdk/telnyx";

const getEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const senders = createSenderRegistry([
  // Replace with a number you actually own on Telnyx.
  { id: "alerts", alias: "alerts", phoneNumber: "+15550102000", provider: "telnyx" },
]);

const sms = createSmsClient({
  adapters: [
    createTelnyxAdapter({
      apiKey: getEnv("TELNYX_API_KEY"),
      messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID,
    }),
  ],
  senderRegistry: senders,
  defaultSender: "alerts",
});

const result = await sms.send({
  to: "+15550109999",
  body: "Your order #1024 has shipped.",
  campaign: { id: "order_alerts", brand: "Example Inc" },
  consent: { granted: true, source: "checkout" },
});

console.log(result.provider, result.messageId, result.status, result.cost);
