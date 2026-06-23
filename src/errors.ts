export type SmsErrorCode =
  | "invalid_number"
  | "invalid_message"
  | "blocked_by_compliance"
  | "unregistered_sender"
  | "rate_limited"
  | "carrier_filtering"
  | "provider_auth"
  | "transient_provider_error"
  | "provider_error"
  | "duplicate_sender_binding"
  | "provider_not_found"
  | "sender_not_found"
  | "unknown";

const RETRYABLE_CODES = new Set<SmsErrorCode>([
  "rate_limited",
  "transient_provider_error",
]);

export interface SmsErrorOptions {
  retryable?: boolean;
  details?: unknown;
  cause?: unknown;
}

export class SmsSdkError extends Error {
  readonly code: SmsErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(message: string, code: SmsErrorCode = "unknown", opts: SmsErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = opts.retryable ?? RETRYABLE_CODES.has(code);
    this.details = opts.details;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

export class SmsValidationError extends SmsSdkError {
  constructor(message: string, code: SmsErrorCode = "invalid_message", opts: SmsErrorOptions = {}) {
    super(message, code, opts);
  }
}

export class SmsComplianceError extends SmsSdkError {
  constructor(message: string, code: SmsErrorCode = "blocked_by_compliance", opts: SmsErrorOptions = {}) {
    super(message, code, opts);
  }
}

export class SmsProviderError extends SmsSdkError {
  readonly provider: string;
  readonly statusCode?: number;

  constructor(
    message: string,
    provider: string,
    code: SmsErrorCode = "provider_error",
    opts: SmsErrorOptions & { statusCode?: number } = {},
  ) {
    super(message, code, opts);
    this.provider = provider;
    this.statusCode = opts.statusCode;
  }
}

export class SmsProviderNotFoundError extends SmsSdkError {
  constructor(message: string, opts: SmsErrorOptions = {}) {
    super(message, "provider_not_found", opts);
  }
}

export class SmsSenderNotFoundError extends SmsSdkError {
  constructor(message: string, code: SmsErrorCode = "sender_not_found", opts: SmsErrorOptions = {}) {
    super(message, code, opts);
  }
}

/** Default HTTP status -> error code mapping shared by fetch-based adapters. */
export function classifyHttpStatus(status: number): SmsErrorCode {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "transient_provider_error";
  if (status === 400 || status === 422) return "invalid_message";
  return "provider_error";
}
