export * from "./types.js";
export * from "./errors.js";
export {
  SenderRegistry,
  createSenderRegistry,
} from "./sender-registry.js";
export {
  SmsClient,
  createSmsClient,
  type CreateSmsClientOptions,
  type SendOptions,
  type RetryOptions,
  type FallbackConfig,
  type ObservabilityHooks,
} from "./client.js";
export { validateMessage, type ComplianceConfig, type ValidationResult } from "./validate.js";
export { isE164, estimateSegments, redactPhone, redactMessage, withRetry, type RetryConfig } from "./util.js";

// Convenience re-export of the in-memory adapter for tests and dry-runs.
export { createMemoryAdapter, MemoryAdapter, type MemoryAdapterOptions } from "./adapters/memory.js";
