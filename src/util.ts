import { SmsSdkError } from "./errors.js";
import type { SmsMessage } from "./types.js";

/** E.164: leading +, first digit 1-9, total 7-15 digits. */
const E164 = /^\+[1-9]\d{6,14}$/;

export function isE164(value: string | undefined | null): value is string {
  return typeof value === "string" && E164.test(value);
}

/**
 * Rough GSM-7 segment estimate. Single SMS = 160 chars, concatenated = 153/seg.
 * ponytail: GSM-7 vs UCS-2 detection skipped; assumes GSM-7. Add encoding
 * detection if non-latin bodies need accurate billing.
 */
export function estimateSegments(body: string): number {
  const len = body.length;
  if (len === 0) return 1;
  if (len <= 160) return 1;
  return Math.ceil(len / 153);
}

/** Mask the middle of a phone number for logs: +15551234567 -> +1555***4567. */
export function redactPhone(value: string): string {
  if (!value) return value;
  if (value.length <= 7) return value.replace(/.(?=.{2})/g, "*");
  return value.slice(0, 5) + "***" + value.slice(-4);
}

/** Produce a log-safe view of a message (no PII body, masked numbers). */
export function redactMessage(message: SmsMessage): Record<string, unknown> {
  return {
    to: redactPhone(message.to ?? ""),
    from: message.from ? redactPhone(message.from) : undefined,
    sender: message.sender,
    bodyLength: message.body?.length ?? 0,
    hasMedia: (message.mediaUrls?.length ?? 0) > 0,
    tags: message.tags,
    campaignId: message.campaign?.id,
    idempotencyKey: message.idempotencyKey,
  };
}

export interface RetryConfig {
  /** Total attempts including the first try. Default 3. */
  attempts?: number;
  /** Base backoff in ms; doubles each retry. Default 200. */
  baseDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function defaultRetryable(err: unknown): boolean {
  return err instanceof SmsSdkError && err.retryable;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, config: RetryConfig = {}): Promise<T> {
  const attempts = Math.max(1, config.attempts ?? 3);
  const baseDelayMs = config.baseDelayMs ?? 200;
  const isRetryable = config.isRetryable ?? defaultRetryable;
  const sleep = config.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const willRetry = attempt < attempts && isRetryable(err);
      if (!willRetry) throw err;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      config.onRetry?.({ attempt, error: err, delayMs });
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
