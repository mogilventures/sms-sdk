import { SmsComplianceError, SmsValidationError } from "./errors.js";
import { estimateSegments, isE164 } from "./util.js";
import type { SmsMessage } from "./types.js";

export interface ComplianceConfig {
  /** Hard-block sends without granted consent. Default false. */
  requireConsent?: boolean;
  /** Warn (not block) when no campaign / A2P metadata is attached. Default true. */
  warnMissingCampaign?: boolean;
  /** Warn when consent is absent but not required. Default true. */
  warnMissingConsent?: boolean;
  /** Max body length before a "many segments" warning. Default 1600. */
  maxBodyLength?: number;
}

export interface ValidationResult {
  warnings: string[];
}

/**
 * Validate an outbound message. Throws {@link SmsValidationError} for hard
 * input errors and {@link SmsComplianceError} when consent is required but
 * missing. Soft issues are returned as `warnings`.
 */
export function validateMessage(message: SmsMessage, compliance: ComplianceConfig = {}): ValidationResult {
  const warnings: string[] = [];

  if (!message || typeof message !== "object") {
    throw new SmsValidationError("message must be an object", "invalid_message");
  }
  if (!isE164(message.to)) {
    throw new SmsValidationError(
      `"to" must be an E.164 phone number, got: ${JSON.stringify(message.to)}`,
      "invalid_number",
    );
  }
  if (typeof message.body !== "string" || message.body.trim().length === 0) {
    throw new SmsValidationError('"body" must be a non-empty string', "invalid_message");
  }

  const warnMissingCampaign = compliance.warnMissingCampaign ?? true;
  const warnMissingConsent = compliance.warnMissingConsent ?? true;
  const maxBodyLength = compliance.maxBodyLength ?? 1600;

  if (warnMissingConsent && !message.consent?.granted) {
    warnings.push("No granted consent recorded for this recipient.");
  }
  if (warnMissingCampaign && !message.campaign?.id) {
    warnings.push("No campaign / A2P metadata attached; carrier filtering risk is higher.");
  }
  if (message.body.length > maxBodyLength) {
    warnings.push(
      `Body is ${message.body.length} chars (~${estimateSegments(message.body)} segments); consider shortening.`,
    );
  }
  if (message.mediaUrls?.length) {
    warnings.push("Message includes media; ensure the resolved provider supports MMS.");
  }

  if (compliance.requireConsent && !message.consent?.granted) {
    throw new SmsComplianceError(
      "Consent is required by compliance config but message.consent.granted is not true.",
      "blocked_by_compliance",
    );
  }

  return { warnings };
}
