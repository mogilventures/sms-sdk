/**
 * Core type definitions for the SMS SDK.
 *
 * Design note: an SMS phone number can only live with one vendor at a time, so
 * the unit of identity here is an {@link OwnedSender} (a phone number bound to
 * exactly one provider), not a free-floating "from" string.
 */

export type SmsStatus =
  | "accepted"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | "unknown";

export interface SmsConsent {
  /** Whether the recipient has granted consent to be messaged. */
  granted: boolean;
  /** Where consent was captured (e.g. "web_signup", "double_opt_in"). */
  source?: string;
  /** ISO-8601 timestamp of when consent was captured. */
  timestamp?: string;
}

export interface SmsCampaign {
  /** Provider/registry campaign id (e.g. an A2P 10DLC campaign id). */
  id?: string;
  brand?: string;
  useCase?: string;
}

export interface SmsMessage {
  /** Recipient phone number in E.164 form (e.g. "+15551234567"). */
  to: string;
  body: string;
  /** Owned sender id OR an E.164 phone number that resolves to an owned sender. */
  from?: string;
  /** Alias selector for an owned sender id (alternative to `from`). */
  sender?: string;
  mediaUrls?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  consent?: SmsConsent;
  campaign?: SmsCampaign;
  /** Caller-supplied idempotency key, forwarded to providers that support it. */
  idempotencyKey?: string;
}

/** A send request after sender resolution — what an adapter actually receives. */
export interface NormalizedSendRequest {
  /** Resolved E.164 phone number that owns the send. */
  from: string;
  to: string;
  body: string;
  mediaUrls?: string[];
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  campaign?: SmsCampaign;
  /** The owned sender id this send is bound to. */
  senderId: string;
}

export interface SmsCost {
  amount: number;
  currency: string;
}

export interface SmsResult {
  provider: string;
  messageId: string;
  status: SmsStatus;
  from: string;
  to: string;
  segments?: number;
  cost?: SmsCost | null;
  /** Non-fatal validation/compliance warnings surfaced for this send. */
  warnings?: string[];
  /** Raw provider response for debugging. */
  raw?: unknown;
}

/** Wrapper passed to {@link SmsAdapter.parseInboundWebhook}. */
export interface InboundWebhookInput {
  /** Already-parsed body (JSON object or form key/value map). */
  body?: unknown;
  /** Raw request body string (form-encoded or JSON). */
  rawBody?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

/**
 * Normalized inbound SMS event. Inbound support is EXPERIMENTAL: parsing and
 * normalization are implemented, but full inbound workflows (replies, opt-out
 * state machines, delivery-receipt reconciliation) are not yet provided.
 */
export interface InboundSmsEvent {
  provider: string;
  messageId?: string;
  /** Sender of the inbound message (the end user), E.164. */
  from: string;
  /** The owned number that received the message, E.164. */
  to: string;
  body: string;
  mediaUrls: string[];
  receivedAt?: string;
  raw: unknown;
}

export interface Capabilities {
  sms: boolean;
  mms: boolean;
  inbound: boolean;
  statusCallback: boolean;
  alphanumericSender: boolean;
  tollFree: boolean;
  shortCode: boolean;
  /** Supports attaching A2P / 10DLC campaign metadata to a send. */
  a2pMetadata: boolean;
}

export interface SmsAdapter {
  readonly name: string;
  readonly capabilities: Capabilities;
  send(req: NormalizedSendRequest): Promise<SmsResult>;
  parseInboundWebhook(input: InboundWebhookInput): InboundSmsEvent;
}

/** A phone number bound to exactly one provider. */
export interface OwnedSender {
  /** Stable application id for this sender. */
  id: string;
  /** E.164 phone number, alphanumeric sender id, or short code. */
  phoneNumber: string;
  /** Name of the adapter that owns this number. */
  provider: string;
  /** Optional human alias (also usable as a selector). */
  alias?: string;
  metadata?: Record<string, unknown>;
}
