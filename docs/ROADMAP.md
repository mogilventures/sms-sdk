# Roadmap

Public, non-binding roadmap for `@mogilventures/sms-sdk`. Order is rough
priority, not a commitment. Anything marked experimental in the README may
change shape before 1.0.

## Webhook signature verification

Verify provider signatures (Twilio `X-Twilio-Signature`, Telnyx Ed25519,
Plivo) before trusting an inbound payload. Today `parseInbound` normalizes the
body but does **not** authenticate it — callers must verify upstream. Goal: a
per-adapter `verifyWebhook(input, secret)` returning a boolean, wired into
`parseInbound` as an opt-in guard.

## Delivery-status normalization

Normalize provider delivery receipts / status callbacks into the existing
`SmsStatus` enum the way `parseInbound` normalizes inbound messages — a
`parseStatusCallback(input)` per adapter returning `{ messageId, status, error? }`.

## A2PCheck hosted readiness integration

The current `./a2pcheck` export is fully local and offline (campaign id,
consent, STOP/HELP, link shorteners, sender metadata). A future opt-in hosted
mode would add network-backed checks: campaign/brand registration status, known
carrier filtering signals, and number reputation. Local checks stay the default
and the no-network path.

## Country / sender capability checks

Cross-reference destination country against sender type (long code, toll-free,
short code, alphanumeric) and adapter `Capabilities` to warn on
unsupported/non-deliverable combinations before send.

## Provider error-code matrix

A documented, tested mapping from raw provider error codes to the SDK's
`SmsErrorCode` taxonomy, kept in one place per adapter, so retry/fallback
behavior is predictable across vendors.

## Package publish workflow

CI-driven publish: version tag → build → `npm pack` provenance → publish to npm
with `--provenance`. Until then the package is built and validated in CI but
released manually.

## Inbound opt-out state machine design

A real opt-out lifecycle — `STOP`/`START`/`HELP` keyword handling, per-recipient
subscription state, and a pluggable store interface — so consent state survives
across messages. Today opt-out is keyword detection only, with no persistence.
