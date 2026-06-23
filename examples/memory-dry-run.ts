/**
 * Dry-run send with the in-memory adapter — no credentials, no network.
 *
 * Run (after `npm install` + `npm run build`, or with tsx):
 *   npx tsx examples/memory-dry-run.ts
 */
import { createSmsClient, createSenderRegistry } from "@mogilventures/sms-sdk";
import { createMemoryAdapter } from "@mogilventures/sms-sdk/testing";

const memory = createMemoryAdapter({ name: "twilio" }); // pretend to be twilio

const senders = createSenderRegistry([
  { id: "login-otp", alias: "otp", phoneNumber: "+15550101000", provider: "twilio" },
]);

const sms = createSmsClient({
  adapters: [memory],
  senderRegistry: senders,
  defaultSender: "otp",
});

const result = await sms.send({
  to: "+15550109999",
  body: "Your verification code is 123456.",
  campaign: { id: "login_otp" },
  consent: { granted: true, source: "signup_form" },
});

console.log("result:", result.provider, result.messageId, result.status);
console.log("warnings:", result.warnings ?? []);
console.log("recorded sends:", memory.sent.length);
