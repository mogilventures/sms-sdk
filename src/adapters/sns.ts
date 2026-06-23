import crypto from "node:crypto";
import { SmsProviderError, classifyHttpStatus } from "../errors.js";
import { estimateSegments, isE164 } from "../util.js";
import { extractPayload, resolveFetch, str, type FetchLike } from "./shared.js";
import type {
  Capabilities,
  InboundSmsEvent,
  InboundWebhookInput,
  NormalizedSendRequest,
  SmsAdapter,
  SmsResult,
} from "../types.js";

export interface SnsAdapterOptions {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  /** "Transactional" (default) or "Promotional". */
  smsType?: "Transactional" | "Promotional";
  /** Alphanumeric sender id (where supported by destination country). */
  senderId?: string;
  /** Fixed timestamp for deterministic signing in tests. */
  now?: () => Date;
  fetch?: FetchLike;
}

// SNS Publish does not own phone numbers like other vendors; the "from" maps to
// an origination number message attribute when it is an E.164 number.
const CAPS: Capabilities = {
  sms: true,
  mms: false,
  inbound: false,
  statusCallback: false,
  alphanumericSender: true,
  tollFree: true,
  shortCode: true,
  a2pMetadata: false,
};

const SERVICE = "sns";
const VERSION = "2010-03-31";

function hmac(key: crypto.BinaryLike | crypto.KeyObject, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}
function amzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export class SnsAdapter implements SmsAdapter {
  readonly name = "sns";
  readonly capabilities = CAPS;
  private fetch: FetchLike;
  private now: () => Date;

  constructor(private opts: SnsAdapterOptions) {
    if (!opts.accessKeyId || !opts.secretAccessKey || !opts.region) {
      throw new SmsProviderError("SNS adapter requires accessKeyId, secretAccessKey, region", "sns", "provider_auth");
    }
    this.fetch = resolveFetch(opts.fetch);
    this.now = opts.now ?? (() => new Date());
  }

  async send(req: NormalizedSendRequest): Promise<SmsResult> {
    const host = `sns.${this.opts.region}.amazonaws.com`;
    const params: Record<string, string> = {
      Action: "Publish",
      Version: VERSION,
      PhoneNumber: req.to,
      Message: req.body,
    };
    let attrIndex = 1;
    const addAttr = (name: string, value: string) => {
      params[`MessageAttributes.entry.${attrIndex}.Name`] = name;
      params[`MessageAttributes.entry.${attrIndex}.Value.DataType`] = "String";
      params[`MessageAttributes.entry.${attrIndex}.Value.StringValue`] = value;
      attrIndex += 1;
    };
    addAttr("AWS.SNS.SMS.SMSType", this.opts.smsType ?? "Transactional");
    if (isE164(req.from)) addAttr("AWS.MM.SMS.OriginationNumber", req.from);
    else if (req.from || this.opts.senderId) addAttr("AWS.SNS.SMS.SenderID", req.from || this.opts.senderId!);

    const body = new URLSearchParams(params).toString();
    const headers = this.sign(host, body);

    const res = await this.fetch(`https://${host}/`, { method: "POST", headers, body });
    const text = await res.text().catch(() => "");

    if (!res.ok) {
      const code = /<Code>(.*?)<\/Code>/.exec(text)?.[1] ?? "";
      const message = /<Message>(.*?)<\/Message>/.exec(text)?.[1] ?? `SNS error ${res.status}`;
      const errCode = /Throttl/i.test(code) ? "rate_limited" : /Auth|Signature|Token/i.test(code) ? "provider_auth" : classifyHttpStatus(res.status);
      throw new SmsProviderError(message, "sns", errCode, { statusCode: res.status, details: text });
    }

    const messageId = /<MessageId>(.*?)<\/MessageId>/.exec(text)?.[1] ?? "";
    return {
      provider: "sns",
      messageId,
      // Publish is fire-and-forget; no synchronous delivery status.
      status: "accepted",
      from: req.from,
      to: req.to,
      segments: estimateSegments(req.body),
      cost: null,
      raw: text,
    };
  }

  private sign(host: string, body: string): Record<string, string> {
    const now = this.now();
    const date = amzDate(now);
    const dateStamp = date.slice(0, 8);
    const region = this.opts.region;

    const signed: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      host,
      "x-amz-date": date,
    };
    if (this.opts.sessionToken) signed["x-amz-security-token"] = this.opts.sessionToken;

    const signedHeaderNames = Object.keys(signed).sort();
    const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${signed[k]}\n`).join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256hex(body)].join("\n");

    const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256hex(canonicalRequest)].join("\n");

    const kDate = hmac(`AWS4${this.opts.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, SERVICE);
    const kSigning = hmac(kService, "aws4_request");
    const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

    return {
      ...signed,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  parseInboundWebhook(input: InboundWebhookInput): InboundSmsEvent {
    // SNS does not deliver inbound SMS the way carriers/aggregators do; this is
    // a best-effort normalization for SNS notifications wrapping an inbound MO.
    const p = extractPayload(input);
    const inner = ((): Record<string, unknown> => {
      if (typeof p.Message === "string") {
        try {
          return JSON.parse(p.Message) as Record<string, unknown>;
        } catch {
          return p;
        }
      }
      return p;
    })();
    return {
      provider: "sns",
      messageId: str(p.MessageId ?? inner.messageId) || undefined,
      from: str(inner.originationNumber ?? inner.from),
      to: str(inner.destinationNumber ?? inner.to),
      body: str(inner.messageBody ?? inner.body ?? p.Message),
      mediaUrls: [],
      receivedAt: str(inner.inboundMessageId ? inner.timestamp : p.Timestamp) || undefined,
      raw: p,
    };
  }
}

export function createSnsAdapter(opts: SnsAdapterOptions): SnsAdapter {
  return new SnsAdapter(opts);
}
