# SMS SDK

Compliance-aware TypeScript SDK for transactional A2P SMS across providers.

`@mogilventures/sms-sdk` gives you one typed send API while preserving the most important SMS invariant: **a phone number can only live with one vendor at a time**. Instead of blindly falling back across providers with the same `from` value, the SDK routes through an owned sender registry and only changes the sender number when you explicitly opt in.

## Why this exists

Email provider abstraction is mostly about field mapping, retries, and fallbacks. SMS has those problems plus carrier filtering, sender ownership, A2P/10DLC campaign metadata, opt-in proof, MMS support, inbound replies, and inconsistent delivery/provider errors.

This package is intentionally narrow:

- transactional SMS first;
- sender/phone-number ownership first;
- safe fallback semantics;
- normalized provider errors and capabilities;
- dry-run/testing adapters;
- experimental inbound webhook normalization.

## Install

```bash
npm install @mogilventures/sms-sdk
```

## Quickstart

```ts
import { createSmsClient, createSenderRegistry } from "@mogilventures/sms-sdk";
import { createTwilioAdapter } from "@mogilventures/sms-sdk/twilio";
import { createTelnyxAdapter } from "@mogilventures/sms-sdk/telnyx";

const getEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const senders = createSenderRegistry([
  {
    id: "login-otp-us",
    alias: "otp",
    phoneNumber: "+15551230100",
    provider: "twilio",
  },
  {
    id: "support-us",
    alias: "support",
    phoneNumber: "+15551230200",
    provider: "telnyx",
  },
]);

const sms = createSmsClient({
  adapters: [
    createTwilioAdapter({
      accountSid: getEnv("TWILIO_ACCOUNT_SID"),
      authToken: getEnv("TWILIO_AUTH_TOKEN"),
    }),
    createTelnyxAdapter({ apiKey: getEnv("TELNYX_API_KEY") }),
  ],
  senderRegistry: senders,
  defaultSender: "otp",
  compliance: { requireConsent: true },
  retry: { attempts: 2 },
});

const result = await sms.send({
  to: "+15551239999",
  body: "Your verification code is 123456.",
  sender: "otp",
  consent: {
    granted: true,
    source: "signup_form",
    timestamp: new Date().toISOString(),
  },
  campaign: { id: "login_otp" },
  idempotencyKey: "login_otp:user_123:2026-06-23T16:00Z",
});

console.log(result.provider, result.messageId, result.status);
```

## Sender ownership model

A phone number is represented as an `OwnedSender`:

```ts
{
  id: "billing-alerts",
  alias: "billing",
  phoneNumber: "+15551230300",
  provider: "plivo"
}
```

The registry enforces one binding per phone number. This prevents unsafe assumptions like "send from this Twilio number through Telnyx during a Twilio outage" — that does not work unless the number has actually been ported or provisioned there.

Outbound routing works by sender id, alias, or phone number:

```ts
await sms.send({ to: "+15551239999", body: "Hi", from: "billing-alerts" });
await sms.send({ to: "+15551239999", body: "Hi", sender: "billing" });
await sms.send({ to: "+15551239999", body: "Hi", from: "+15551230300" });
```

## Fallbacks are safe by default

Provider-level retries happen against the same sender/provider. Changing the sender number is disabled unless you opt in:

```ts
const sms = createSmsClient({
  adapters,
  senderRegistry,
  fallback: {
    allowSenderFallback: true,
    senders: ["support-backup"],
  },
});
```

Use this only when a different visible `from` number is acceptable for the use case.

## Inbound SMS normalization — experimental

Adapters can normalize inbound webhook payloads. The client can then tie the inbound event back to the owned sender that received it by matching `event.to`.

```ts
const event = sms.parseInbound("twilio", {
  body: {
    MessageSid: "SM123",
    From: "+15551239999",
    To: "+15551230100",
    Body: "STOP",
  },
});

const ownedSender = sms.resolveInbound(event);
console.log(ownedSender?.id); // login-otp-us
```

Full inbound workflows — opt-out state machines, reply routing, delivery-receipt reconciliation, webhook signature verification, persistence — are intentionally not implemented yet.

## Built-in adapters

| Adapter | Import | Notes |
| --- | --- | --- |
| Memory | `@mogilventures/sms-sdk/testing` | Dry-runs and tests; records sent messages. |
| Twilio | `@mogilventures/sms-sdk/twilio` | SMS, MMS, inbound, status callbacks, idempotency header. |
| Telnyx | `@mogilventures/sms-sdk/telnyx` | SMS, MMS, inbound, messaging profiles. |
| Plivo | `@mogilventures/sms-sdk/plivo` | SMS/MMS, callbacks. |
| AWS SNS | `@mogilventures/sms-sdk/sns` | Transactional publish; no native inbound abstraction. |

## CLI

```bash
sms-sdk adapters
sms-sdk doctor
sms-sdk validate --to +15551239999 --body "hello"
sms-sdk validate --to +15551239999 --body "hello" --require-consent
sms-sdk test-send --from +15551230100 --to +15551239999 --body "dry run"
sms-sdk inbound-parse --provider twilio --json '{"From":"+15551239999","To":"+15551230100","Body":"STOP"}'
```

`doctor` only checks local runtime and credential environment variables; it does not send a network request.

## Examples

Runnable examples live in [`examples/`](examples). The dry-run and fallback
examples need no credentials; the provider examples read placeholder env vars.

```bash
npx tsx examples/memory-dry-run.ts
```

| Example | What it shows |
| --- | --- |
| [memory-dry-run.ts](examples/memory-dry-run.ts) | Send with the in-memory adapter — no network, no credentials. |
| [safe-fallback.ts](examples/safe-fallback.ts) | Opt-in fallback to a different owned number when the primary fails. |
| [inbound-twilio-express.ts](examples/inbound-twilio-express.ts) | Inbound webhook handler shape (express wiring shown in comments). |
| [twilio-send.ts](examples/twilio-send.ts) | Real Twilio send using `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`. |
| [telnyx-send.ts](examples/telnyx-send.ts) | Real Telnyx send using `TELNYX_API_KEY`. |

## A2PCheck readiness

`@mogilventures/sms-sdk/a2pcheck` runs **local, offline** pre-send checks for
common A2P/10DLC deliverability problems. It is readiness guidance, not legal
advice and not a carrier verdict — it makes no network calls. Findings carry a
severity of `info`, `warn`, or `block`.

```ts
import { a2pcheckReadiness } from "@mogilventures/sms-sdk/a2pcheck";

const a2p = a2pcheckReadiness({ requireOptOutLanguage: true });

const report = a2p.checkMessage({
  to: "+15550109999",
  body: "Your code is 123456. Reply STOP to opt out.",
  campaign: { id: "login_otp" },
  consent: { granted: true, source: "signup_form" },
});

if (report.blocked) {
  // hard problems (invalid recipient, empty body, or anything you marked required)
}
report.findings.forEach((f) => console.log(f.severity, f.code, f.message));

// Or fail fast as a pre-send guard (throws SmsComplianceError on a block finding):
a2p.assertReady(message);
```

Checks include: missing campaign/10DLC id, missing consent, STOP/HELP opt-out
language, public link shorteners, missing sender metadata, and body length.
Use `requireCampaignId` / `requireConsent` to escalate those warnings to blocks.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Highlights: webhook signature
verification, delivery-status normalization, hosted A2PCheck readiness,
country/sender capability checks, a provider error-code matrix, a package
publish workflow, and an inbound opt-out state machine.

## Error taxonomy

Provider responses are normalized to `SmsSdkError` subclasses with codes such as:

- `invalid_number`
- `blocked_by_compliance`
- `unregistered_sender`
- `rate_limited`
- `carrier_filtering`
- `provider_auth`
- `transient_provider_error`
- `duplicate_sender_binding`

## Development

```bash
npm install --include=dev
npm test
npm run typecheck
npm run build
```

The test suite mocks provider `fetch` calls and does not send real SMS.

## License

MIT
