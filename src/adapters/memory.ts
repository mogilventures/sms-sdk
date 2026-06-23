import { SmsProviderError } from "../errors.js";
import { estimateSegments } from "../util.js";
import { extractPayload, str } from "./shared.js";
import type {
  Capabilities,
  InboundSmsEvent,
  InboundWebhookInput,
  NormalizedSendRequest,
  SmsAdapter,
  SmsResult,
} from "../types.js";

export interface MemoryAdapterOptions {
  name?: string;
  capabilities?: Partial<Capabilities>;
  /**
   * Optional hook to simulate provider behavior in tests. Return a partial
   * result to customize, or throw an SmsSdkError to simulate failure.
   */
  onSend?: (req: NormalizedSendRequest, attempt: number) => Partial<SmsResult> | void;
}

const DEFAULT_CAPS: Capabilities = {
  sms: true,
  mms: true,
  inbound: true,
  statusCallback: false,
  alphanumericSender: true,
  tollFree: true,
  shortCode: true,
  a2pMetadata: true,
};

/** In-memory adapter for tests and dry-runs. Records everything it "sends". */
export class MemoryAdapter implements SmsAdapter {
  readonly name: string;
  readonly capabilities: Capabilities;
  readonly sent: Array<NormalizedSendRequest & { messageId: string }> = [];
  private counter = 0;
  private onSend?: MemoryAdapterOptions["onSend"];

  constructor(opts: MemoryAdapterOptions = {}) {
    this.name = opts.name ?? "memory";
    this.capabilities = { ...DEFAULT_CAPS, ...opts.capabilities };
    this.onSend = opts.onSend;
  }

  async send(req: NormalizedSendRequest): Promise<SmsResult> {
    this.counter += 1;
    const override = this.onSend?.(req, this.counter) ?? {};
    const messageId = override.messageId ?? `mem_${this.name}_${this.counter}`;
    this.sent.push({ ...req, messageId });
    return {
      provider: this.name,
      messageId,
      status: override.status ?? "queued",
      from: req.from,
      to: req.to,
      segments: override.segments ?? estimateSegments(req.body),
      cost: override.cost ?? { amount: 0, currency: "USD" },
      raw: override.raw ?? { simulated: true },
    };
  }

  parseInboundWebhook(input: InboundWebhookInput): InboundSmsEvent {
    const p = extractPayload(input);
    if (!str(p.to ?? p.To) || !str(p.from ?? p.From)) {
      throw new SmsProviderError("Inbound payload missing to/from", this.name, "invalid_message");
    }
    return {
      provider: this.name,
      messageId: str(p.messageId ?? p.id) || undefined,
      from: str(p.from ?? p.From),
      to: str(p.to ?? p.To),
      body: str(p.body ?? p.Body ?? p.text),
      mediaUrls: Array.isArray(p.mediaUrls) ? (p.mediaUrls as string[]) : [],
      receivedAt: str(p.receivedAt) || undefined,
      raw: p,
    };
  }
}

export function createMemoryAdapter(opts: MemoryAdapterOptions = {}): MemoryAdapter {
  return new MemoryAdapter(opts);
}
