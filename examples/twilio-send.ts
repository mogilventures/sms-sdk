/**
 * Real Twilio send. Requires live credentials in the environment:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 *
 *   npx tsx examples/twilio-send.ts
 */
import { createSmsClient, createSenderRegistry } from "@mogilventures/sms-sdk";
import { createTwilioAdapter } from "@mogilventures/sms-sdk/twilio";
import { a2pcheckReadiness } from "@mogilventures/sms-sdk/a2pcheck";

const getEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const senders = createSenderRegistry([
  // Replace with a number you actually own on Twilio.
  { id: "login-otp", alias: "otp", phoneNumber: "+15550101000", provider: "twilio" },
]);

const sms = createSmsClient({
  adapters: [
    createTwilioAdapter({
      accountSid: getEnv("TWILIO_ACCOUNT_SID"),
      authToken: getEnv("TWILIO_AUTH_TOKEN"),
    }),
  ],
  senderRegistry: senders,
  defaultSender: "otp",
  retry: { attempts: 2 },
});

const message = {
  to: "+15550109999",
  body: "Your verification code is 123456. Reply STOP to opt out.",
  campaign: { id: "login_otp", brand: "Example Inc" },
  consent: { granted: true, source: "signup_form", timestamp: new Date().toISOString() },
  idempotencyKey: "login_otp:user_123",
};

// Pre-send readiness check (offline) before spending a real send.
a2pcheckReadiness({ requireOptOutLanguage: true }).assertReady(message);

const result = await sms.send(message);
console.log(result.provider, result.messageId, result.status, result.cost);
