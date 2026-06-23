/**
 * Inbound Twilio webhook handler shape.
 *
 * No express dependency is required to read this example — it shows the handler
 * body and includes (commented) express wiring. Twilio posts inbound SMS as
 * application/x-www-form-urlencoded, so pass the parsed form fields as `body`.
 *
 * To run a real server: `npm install express` and uncomment the bottom block.
 */
import { createSmsClient, createSenderRegistry } from "@mogilventures/sms-sdk";
import { createMemoryAdapter } from "@mogilventures/sms-sdk/testing";

const senders = createSenderRegistry([
  { id: "support-us", phoneNumber: "+15550101000", provider: "twilio" },
]);
const sms = createSmsClient({
  adapters: [createMemoryAdapter({ name: "twilio" })],
  senderRegistry: senders,
});

/** Framework-agnostic handler: takes already-parsed form fields. */
export function handleInbound(formBody: Record<string, string>): string {
  const event = sms.parseInbound("twilio", { body: formBody });
  const ownedSender = sms.resolveInbound(event); // which of our numbers received it

  console.log(`inbound from ${event.from} -> sender ${ownedSender?.id ?? "unknown"}: ${event.body}`);

  // ponytail: opt-out handling is a stub — STOP detection only, no persistence.
  // A full opt-out state machine is on the roadmap (docs/ROADMAP.md).
  if (/^\s*stop\b/i.test(event.body)) {
    return "<Response><Message>You have been unsubscribed.</Message></Response>";
  }
  return "<Response></Response>"; // TwiML: empty = no auto-reply
}

// Demo with a Request-like payload (what express's urlencoded parser produces):
console.log(handleInbound({ MessageSid: "SM123", From: "+15550109999", To: "+15550101000", Body: "STOP" }));

/*
import express from "express";
const app = express();
app.use(express.urlencoded({ extended: false }));
app.post("/webhooks/twilio/inbound", (req, res) => {
  // TODO: verify the X-Twilio-Signature header before trusting req.body.
  res.type("text/xml").send(handleInbound(req.body));
});
app.listen(3000);
*/
