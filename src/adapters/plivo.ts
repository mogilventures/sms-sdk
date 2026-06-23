import { SmsProviderError, classifyHttpStatus } from "../errors.js";
import { estimateSegments } from "../util.js";
import { extractPayload, resolveFetch, str, type FetchLike } from "./shared.js";
import type {
  Capabilities,
  InboundSmsEvent,
  InboundWebhookInput,
  NormalizedSendRequest,
  SmsAdapter,
  SmsResult,
} from "../types.js";

export interface PlivoAdapterOptions {
  authId: string;
  authToken: string;
  /** Delivery-report callback URL applied to each send. */
  callbackUrl?: string;
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
  a2pMetadata: false,
};

export class PlivoAdapter implements SmsAdapter {
  readonly name = "plivo";
  readonly capabilities = CAPS;
  private fetch: FetchLike;
  private baseUrl: string;

  constructor(private opts: PlivoAdapterOptions) {
    if (!opts.authId || !opts.authToken) {
      throw new SmsProviderError("Plivo adapter requires authId and authToken", "plivo", "provider_auth");
    }
    this.fetch = resolveFetch(opts.fetch);
    this.baseUrl = opts.baseUrl ?? "https://api.plivo.com";
  }

  async send(req: NormalizedSendRequest): Promise<SmsResult> {
    const url = `${this.baseUrl}/v1/Account/${this.opts.authId}/Message/`;
    const payload: Record<string, unknown> = {
      src: req.from,
      dst: req.to,
      text: req.body,
      type: req.mediaUrls?.length ? "mms" : "sms",
    };
    if (req.mediaUrls?.length) payload.media_urls = req.mediaUrls;
    if (this.opts.callbackUrl) payload.url = this.opts.callbackUrl;

    const auth = Buffer.from(`${this.opts.authId}:${this.opts.authToken}`).toString("base64");
    const res = await this.fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const msg = str(json.error ?? json.message) || `Plivo error ${res.status}`;
      throw new SmsProviderError(msg, "plivo", classifyHttpStatus(res.status), {
        statusCode: res.status,
        details: json,
      });
    }

    const uuids = json.message_uuid as string[] | undefined;
    return {
      provider: "plivo",
      messageId: Array.isArray(uuids) ? str(uuids[0]) : str(json.message_uuid),
      // Plivo returns 202 Accepted; delivery status arrives via callback.
      status: "queued",
      from: req.from,
      to: req.to,
      segments: estimateSegments(req.body),
      cost: null,
      raw: json,
    };
  }

  parseInboundWebhook(input: InboundWebhookInput): InboundSmsEvent {
    const p = extractPayload(input);
    const mediaCount = Number(p.MediaCount ?? 0) || 0;
    const mediaUrls: string[] = [];
    for (let i = 0; i < mediaCount; i++) {
      const u = str(p[`Media${i}`]);
      if (u) mediaUrls.push(u);
    }
    return {
      provider: "plivo",
      messageId: str(p.MessageUUID) || undefined,
      from: str(p.From),
      to: str(p.To),
      body: str(p.Text),
      mediaUrls,
      raw: p,
    };
  }
}

export function createPlivoAdapter(opts: PlivoAdapterOptions): PlivoAdapter {
  return new PlivoAdapter(opts);
}
