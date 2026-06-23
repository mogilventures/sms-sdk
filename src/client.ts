import { SmsProviderNotFoundError, SmsSenderNotFoundError, SmsSdkError } from "./errors.js";
import { SenderRegistry } from "./sender-registry.js";
import { redactMessage, withRetry } from "./util.js";
import { validateMessage, type ComplianceConfig } from "./validate.js";
import type {
  Capabilities,
  InboundSmsEvent,
  InboundWebhookInput,
  NormalizedSendRequest,
  OwnedSender,
  SmsAdapter,
  SmsMessage,
  SmsResult,
} from "./types.js";

export interface ObservabilityHooks {
  beforeSend?: (event: { senderId: string; provider: string; message: Record<string, unknown> }) => void;
  afterSend?: (event: { senderId: string; provider: string; result: SmsResult }) => void;
  onError?: (event: { senderId: string; provider: string; error: unknown; message: Record<string, unknown> }) => void;
  onRetry?: (event: { senderId: string; provider: string; attempt: number; delayMs: number; error: unknown }) => void;
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  /** Injectable sleep, mainly for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface FallbackConfig {
  /**
   * Allow falling back to a DIFFERENT owned sender (different number, possibly
   * different provider) when the primary send fails. Off by default because a
   * phone number cannot exist with multiple vendors — changing providers means
   * changing the visible "from" number.
   */
  allowSenderFallback?: boolean;
  /** Ordered fallback sender ids/aliases, tried after the primary. */
  senders?: string[];
}

export interface CreateSmsClientOptions {
  adapters: SmsAdapter[];
  senderRegistry: SenderRegistry;
  /** Default sender selector when a message omits `from`/`sender`. */
  defaultSender?: string;
  retry?: RetryOptions;
  fallback?: FallbackConfig;
  compliance?: ComplianceConfig;
  hooks?: ObservabilityHooks;
}

export interface SendOptions {
  /** Per-send override; see {@link FallbackConfig.allowSenderFallback}. */
  allowSenderFallback?: boolean;
  /** Per-send fallback sender ids/aliases (require allowSenderFallback). */
  fallbackSenders?: string[];
  retry?: RetryOptions;
  compliance?: ComplianceConfig;
}

export class SmsClient {
  private adapters = new Map<string, SmsAdapter>();
  private registry: SenderRegistry;
  private defaultSender?: string;
  private retry: RetryOptions;
  private fallback: FallbackConfig;
  private compliance: ComplianceConfig;
  private hooks: ObservabilityHooks;

  constructor(opts: CreateSmsClientOptions) {
    if (!opts.adapters?.length) throw new SmsSdkError("At least one adapter is required", "provider_not_found");
    for (const a of opts.adapters) {
      if (this.adapters.has(a.name)) throw new SmsSdkError(`Duplicate adapter name "${a.name}"`, "provider_error");
      this.adapters.set(a.name, a);
    }
    this.registry = opts.senderRegistry;
    this.defaultSender = opts.defaultSender;
    this.retry = opts.retry ?? {};
    this.fallback = opts.fallback ?? {};
    this.compliance = opts.compliance ?? {};
    this.hooks = opts.hooks ?? {};
  }

  /** Adapter capabilities keyed by adapter name. */
  listAdapterCapabilities(): Record<string, Capabilities> {
    const out: Record<string, Capabilities> = {};
    for (const [name, adapter] of this.adapters) out[name] = adapter.capabilities;
    return out;
  }

  getAdapter(name: string): SmsAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new SmsProviderNotFoundError(`No adapter registered with name "${name}"`);
    return adapter;
  }

  private adapterForSender(sender: OwnedSender): SmsAdapter {
    const adapter = this.adapters.get(sender.provider);
    if (!adapter) {
      throw new SmsProviderNotFoundError(
        `Owned sender "${sender.id}" is bound to provider "${sender.provider}", which has no registered adapter.`,
      );
    }
    return adapter;
  }

  private buildRequest(message: SmsMessage, sender: OwnedSender): NormalizedSendRequest {
    return {
      from: sender.phoneNumber,
      to: message.to,
      body: message.body,
      mediaUrls: message.mediaUrls,
      idempotencyKey: message.idempotencyKey,
      metadata: message.metadata,
      campaign: message.campaign,
      senderId: sender.id,
    };
  }

  private async sendVia(sender: OwnedSender, message: SmsMessage, options: SendOptions, warnings: string[]): Promise<SmsResult> {
    const adapter = this.adapterForSender(sender);
    const req = this.buildRequest(message, sender);
    const redacted = redactMessage(message);
    this.hooks.beforeSend?.({ senderId: sender.id, provider: adapter.name, message: redacted });

    const retry = { ...this.retry, ...options.retry };
    try {
      const result = await withRetry((attempt) => adapter.send(req), {
        attempts: retry.attempts,
        baseDelayMs: retry.baseDelayMs,
        isRetryable: retry.isRetryable,
        sleep: retry.sleep,
        onRetry: ({ attempt, error, delayMs }) =>
          this.hooks.onRetry?.({ senderId: sender.id, provider: adapter.name, attempt, delayMs, error }),
      });
      const withWarnings: SmsResult = warnings.length ? { ...result, warnings } : result;
      this.hooks.afterSend?.({ senderId: sender.id, provider: adapter.name, result: withWarnings });
      return withWarnings;
    } catch (error) {
      this.hooks.onError?.({ senderId: sender.id, provider: adapter.name, error, message: redacted });
      throw error;
    }
  }

  async send(message: SmsMessage, options: SendOptions = {}): Promise<SmsResult> {
    const compliance = { ...this.compliance, ...options.compliance };
    const { warnings } = validateMessage(message, compliance);

    const selector = message.from ?? message.sender ?? this.defaultSender;
    if (!selector) {
      throw new SmsSenderNotFoundError(
        "No sender specified: set message.from, message.sender, or a defaultSender.",
        "unregistered_sender",
      );
    }
    const primary = this.registry.resolve(selector);

    const allowFallback = options.allowSenderFallback ?? this.fallback.allowSenderFallback ?? false;
    const fallbackSelectors = options.fallbackSenders ?? this.fallback.senders ?? [];

    // Primary attempt (with same-provider transient retries inside).
    try {
      return await this.sendVia(primary, message, options, warnings);
    } catch (primaryErr) {
      if (!allowFallback || fallbackSelectors.length === 0) throw primaryErr;

      let lastErr: unknown = primaryErr;
      for (const sel of fallbackSelectors) {
        const fb = this.registry.resolve(sel);
        if (fb.id === primary.id) continue; // never "fall back" to the same number
        try {
          return await this.sendVia(fb, message, options, warnings);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    }
  }

  /** Parse a provider webhook payload into a normalized inbound event. */
  parseInbound(provider: string, input: InboundWebhookInput): InboundSmsEvent {
    return this.getAdapter(provider).parseInboundWebhook(input);
  }

  /** Map an inbound event back to the owned sender that received it (by `to`). */
  resolveInbound(event: InboundSmsEvent): OwnedSender | undefined {
    return this.registry.getByPhone(event.to);
  }

  get senderRegistry(): SenderRegistry {
    return this.registry;
  }
}

export function createSmsClient(options: CreateSmsClientOptions): SmsClient {
  return new SmsClient(options);
}
