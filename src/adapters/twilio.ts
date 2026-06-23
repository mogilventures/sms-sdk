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

export interface TwilioAdapterOptions {
  accountSid: string;
  authToken: string;
  /** Optional Messaging Service SID (used as `From` if no number is given). */
  messagingServiceSid?: string;
  /** Status callback URL applied to every send. */
  statusCallbackUrl?: string;
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

// https://www.twilio.com/docs/api/errors
function mapTwilioCode(httpStatus: number, twilioCode?: number): SmsErrorCode {
  switch (twilioCode) {
    case 21211:
    case 21614:
      return "invalid_number";
    case 21610:
      return "carrier_filtering";
    case 30007:
    case 30008:
      return "carrier_filtering";
    case 20003:
      return "provider_auth";
    case 20429:
      return "rate_limited";
  }
  return classifyHttpStatus(httpStatus);
}

function mapStatus(status: string): SmsStatus {
  const s = status?.toLowerCase();
  if (["queued", "accepted", "sending", "sent", "delivered", "undelivered", "failed"].includes(s)) {
    return s as SmsStatus;
  }
  return "unknown";
}

export class TwilioAdapter implements SmsAdapter {
  readonly name = "twilio";
  readonly capabilities = CAPS;
  private fetch: FetchLike;
  private baseUrl: string;

  constructor(private opts: TwilioAdapterOptions) {
    if (!opts.accountSid || !opts.authToken) {
      throw new SmsProviderError("Twilio adapter requires accountSid and authToken", "twilio", "provider_auth");
    }
    this.fetch = resolveFetch(opts.fetch);
    this.baseUrl = opts.baseUrl ?? "https://api.twilio.com";
  }

  async send(req: NormalizedSendRequest): Promise<SmsResult> {
    const url = `${this.baseUrl}/2010-04-01/Accounts/${this.opts.accountSid}/Messages.json`;
    const form = new URLSearchParams();
    form.set("To", req.to);
    if (this.opts.messagingServiceSid) form.set("MessagingServiceSid", this.opts.messagingServiceSid);
    form.set("From", req.from);
    form.set("Body", req.body);
    for (const m of req.mediaUrls ?? []) form.append("MediaUrl", m);
    if (this.opts.statusCallbackUrl) form.set("StatusCallback", this.opts.statusCallbackUrl);

    const auth = Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64");
    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (req.idempotencyKey) headers["Idempotency-Key"] = req.idempotencyKey;

    const res = await this.fetch(url, { method: "POST", headers, body: form.toString() });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const code = mapTwilioCode(res.status, Number(data.code));
      throw new SmsProviderError(str(data.message) || `Twilio error ${res.status}`, "twilio", code, {
        statusCode: res.status,
        details: data,
      });
    }

    const price = data.price != null ? Number(data.price) : null;
    return {
      provider: "twilio",
      messageId: str(data.sid),
      status: mapStatus(str(data.status)),
      from: str(data.from) || req.from,
      to: str(data.to) || req.to,
      segments: data.num_segments != null ? Number(data.num_segments) : undefined,
      cost: price != null && !Number.isNaN(price) ? { amount: Math.abs(price), currency: str(data.price_unit) || "USD" } : null,
      raw: data,
    };
  }

  parseInboundWebhook(input: InboundWebhookInput): InboundSmsEvent {
    const p = extractPayload(input);
    const numMedia = Number(p.NumMedia ?? 0) || 0;
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const u = str(p[`MediaUrl${i}`]);
      if (u) mediaUrls.push(u);
    }
    return {
      provider: "twilio",
      messageId: str(p.MessageSid ?? p.SmsSid) || undefined,
      from: str(p.From),
      to: str(p.To),
      body: str(p.Body),
      mediaUrls,
      raw: p,
    };
  }
}

export function createTwilioAdapter(opts: TwilioAdapterOptions): TwilioAdapter {
  return new TwilioAdapter(opts);
}
