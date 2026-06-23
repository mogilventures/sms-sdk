import { SmsProviderError, classifyHttpStatus, type SmsErrorCode } from "../errors.js";
import { extractPayload, resolveFetch, str, type FetchLike } from "./shared.js";
import type {
  Capabilities,
  InboundSmsEvent,
  InboundWebhookInput,
  NormalizedSendRequest,
  SmsAdapter,
  SmsResult,
  SmsStatus,
} from "../types.js";

export interface TelnyxAdapterOptions {
  apiKey: string;
  /** Optional Messaging Profile id attached to each send. */
  messagingProfileId?: string;
  webhookUrl?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

const CAPS: Capabilities = {
  sms: true,
  mms: true,
  inbound: true,
  statusCallback: true,
  alphanumericSender: true,
  tollFree: true,
  shortCode: true,
  a2pMetadata: true,
};

function mapStatus(status: string): SmsStatus {
  const s = status?.toLowerCase();
  switch (s) {
    case "queued":
    case "sending":
    case "sent":
    case "delivered":
    case "failed":
      return s as SmsStatus;
    case "delivery_failed":
    case "sending_failed":
      return "failed";
    case "delivery_unconfirmed":
      return "sent";
    default:
      return "unknown";
  }
}

export class TelnyxAdapter implements SmsAdapter {
  readonly name = "telnyx";
  readonly capabilities = CAPS;
  private fetch: FetchLike;
  private baseUrl: string;

  constructor(private opts: TelnyxAdapterOptions) {
    if (!opts.apiKey) throw new SmsProviderError("Telnyx adapter requires apiKey", "telnyx", "provider_auth");
    this.fetch = resolveFetch(opts.fetch);
    this.baseUrl = opts.baseUrl ?? "https://api.telnyx.com";
  }

  async send(req: NormalizedSendRequest): Promise<SmsResult> {
    const url = `${this.baseUrl}/v2/messages`;
    const payload: Record<string, unknown> = {
      from: req.from,
      to: req.to,
      text: req.body,
    };
    if (req.mediaUrls?.length) payload.media_urls = req.mediaUrls;
    if (this.opts.messagingProfileId) payload.messaging_profile_id = this.opts.messagingProfileId;
    if (this.opts.webhookUrl) payload.webhook_url = this.opts.webhookUrl;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      "Content-Type": "application/json",
    };
    if (req.idempotencyKey) headers["Idempotency-Key"] = req.idempotencyKey;

    const res = await this.fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const errors = Array.isArray(json.errors) ? (json.errors as Array<Record<string, unknown>>) : [];
      const first = errors[0] ?? {};
      const code = mapTelnyxCode(res.status, Number(first.code));
      const msg = str(first.detail ?? first.title) || `Telnyx error ${res.status}`;
      throw new SmsProviderError(msg, "telnyx", code, { statusCode: res.status, details: json });
    }

    const data = (json.data ?? {}) as Record<string, unknown>;
    const cost = data.cost as Record<string, unknown> | undefined;
    const toEntry = Array.isArray(data.to) ? (data.to[0] as Record<string, unknown> | undefined) : undefined;
    const parts = data.parts != null ? Number(data.parts) : undefined;
    return {
      provider: "telnyx",
      messageId: str(data.id),
      status: mapStatus(str(toEntry?.status)),
      from: str((data.from as Record<string, unknown> | undefined)?.phone_number) || req.from,
      to: str(toEntry?.phone_number) || req.to,
      segments: parts,
      cost: cost?.amount != null ? { amount: Number(cost.amount), currency: str(cost.currency) || "USD" } : null,
      raw: json,
    };
  }

  parseInboundWebhook(input: InboundWebhookInput): InboundSmsEvent {
    const p = extractPayload(input);
    // Telnyx wraps events: { data: { event_type, payload: {...} } }
    const data = (p.data ?? p) as Record<string, unknown>;
    const payload = (data.payload ?? data) as Record<string, unknown>;
    const from = payload.from as Record<string, unknown> | string | undefined;
    const toList = Array.isArray(payload.to) ? (payload.to as Array<Record<string, unknown>>) : [];
    const media = Array.isArray(payload.media)
      ? (payload.media as Array<Record<string, unknown>>).map((m) => str(m.url)).filter(Boolean)
      : [];
    return {
      provider: "telnyx",
      messageId: str(payload.id) || undefined,
      from: typeof from === "string" ? from : str(from?.phone_number),
      to: str(toList[0]?.phone_number),
      body: str(payload.text),
      mediaUrls: media,
      receivedAt: str(payload.received_at) || undefined,
      raw: p,
    };
  }
}

function mapTelnyxCode(httpStatus: number, telnyxCode?: number): SmsErrorCode {
  // 40300+ family is auth; 40005 invalid number; 10002 rate limit.
  if (telnyxCode === 10002) return "rate_limited";
  if (telnyxCode === 40005 || telnyxCode === 40300) return "invalid_number";
  return classifyHttpStatus(httpStatus);
}

export function createTelnyxAdapter(opts: TelnyxAdapterOptions): TelnyxAdapter {
  return new TelnyxAdapter(opts);
}
