/**
 * A2PCheck — local, offline pre-send readiness checks for A2P SMS.
 *
 * This is conservative *readiness guidance*, not legal advice and not a
 * carrier/registry verdict. It runs entirely in-process (no network calls) and
 * flags common reasons A2P/10DLC traffic gets filtered or rejected so you can
 * fix them before handing a message to a provider.
 *
 * A future hosted integration (see docs/ROADMAP.md) may add network-backed
 * checks; this stub intentionally stays local.
 */

import { SmsComplianceError } from "../errors.js";
import { isE164 } from "../util.js";
import type { OwnedSender, SmsMessage } from "../types.js";

export type A2PSeverity = "info" | "warn" | "block";

export interface A2PFinding {
  /** Stable machine code, e.g. "missing_campaign_id". */
  code: string;
  severity: A2PSeverity;
  message: string;
}

export interface A2PReadinessReport {
  findings: A2PFinding[];
  /** True when no finding has severity "block". */
  ok: boolean;
  /** True when at least one finding has severity "block". */
  blocked: boolean;
}

export interface A2PCheckOptions {
  /** Treat a missing campaign/10DLC id as a hard block instead of a warning. */
  requireCampaignId?: boolean;
  /** Treat missing granted consent as a hard block instead of a warning. */
  requireConsent?: boolean;
  /** Warn when the body never mentions STOP/HELP opt-out language. Default false. */
  requireOptOutLanguage?: boolean;
  /** Flag link-shortener domains (carriers filter these heavily). Default true. */
  flagLinkShorteners?: boolean;
  /** Extra shortener domains to flag, in addition to the built-in list. */
  knownShortenerDomains?: string[];
  /** Max body length before a segment-count warning. Default 320 (~2 segments). */
  warnBodyLength?: number;
}

// Common public URL shorteners that carriers frequently filter for A2P traffic.
const DEFAULT_SHORTENERS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "rebrand.ly",
  "cutt.ly",
];

const URL_RE = /\bhttps?:\/\/[^\s]+/gi;
const STOP_RE = /\bstop\b/i;
const HELP_RE = /\bhelp\b/i;

function findUrls(body: string): string[] {
  return body.match(URL_RE) ?? [];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Build a reusable readiness checker. Helpers returned are pure and offline.
 *
 * @example
 * const a2p = a2pcheckReadiness({ requireOptOutLanguage: true });
 * const report = a2p.checkMessage(message, sender);
 * if (report.blocked) throw new Error("not ready");
 */
export function a2pcheckReadiness(options: A2PCheckOptions = {}) {
  const flagShorteners = options.flagLinkShorteners ?? true;
  const warnBodyLength = options.warnBodyLength ?? 320;
  const shorteners = new Set([...DEFAULT_SHORTENERS, ...(options.knownShortenerDomains ?? [])]);

  function checkMessage(message: SmsMessage, sender?: OwnedSender): A2PReadinessReport {
    const findings: A2PFinding[] = [];
    const add = (severity: A2PSeverity, code: string, msg: string) =>
      findings.push({ code, severity, message: msg });

    // Hard input sanity — these block regardless of config.
    if (!isE164(message.to)) {
      add("block", "invalid_recipient", `"to" is not an E.164 number: ${JSON.stringify(message.to)}`);
    }
    const body = typeof message.body === "string" ? message.body : "";
    if (body.trim().length === 0) {
      add("block", "empty_body", "Message body is empty.");
    }

    // Campaign / 10DLC registration.
    if (!message.campaign?.id) {
      add(
        options.requireCampaignId ? "block" : "warn",
        "missing_campaign_id",
        "No A2P/10DLC campaign id attached; unregistered traffic is heavily filtered.",
      );
    }
    if (message.campaign?.id && !message.campaign?.brand) {
      add("info", "missing_brand", "Campaign id present but no brand recorded for audit trail.");
    }

    // Consent / opt-in proof.
    if (!message.consent?.granted) {
      add(
        options.requireConsent ? "block" : "warn",
        "missing_consent",
        "No granted opt-in consent recorded for this recipient.",
      );
    } else if (!message.consent.source) {
      add("info", "consent_no_source", "Consent granted but no capture source recorded.");
    }

    // STOP/HELP opt-out language (only when the caller asks us to enforce it).
    if (options.requireOptOutLanguage && body) {
      if (!STOP_RE.test(body)) {
        add("warn", "missing_stop_language", 'Body does not mention "STOP"; opt-out instructions are often required.');
      }
      if (!HELP_RE.test(body)) {
        add("info", "missing_help_language", 'Body does not mention "HELP"; consider adding help instructions.');
      }
    }

    // URL / link policy hints.
    const urls = body ? findUrls(body) : [];
    if (urls.length && flagShorteners) {
      const flagged = [...new Set(urls.map(hostOf).filter((h) => shorteners.has(h)))];
      if (flagged.length) {
        add(
          "warn",
          "link_shortener",
          `Public link shortener(s) detected (${flagged.join(", ")}); carriers filter these. Use a branded domain.`,
        );
      }
    }

    // Sender metadata completeness.
    if (!sender && !message.from && !message.sender) {
      add("warn", "missing_sender", "No sender resolved or specified; sender identity affects deliverability.");
    }
    if (sender && !sender.provider) {
      add("info", "sender_no_provider", `Owned sender "${sender.id}" has no provider binding.`);
    }

    // Length / segmentation.
    if (body.length > warnBodyLength) {
      add("info", "long_body", `Body is ${body.length} chars; long messages cost more segments and filter harder.`);
    }

    const blocked = findings.some((f) => f.severity === "block");
    return { findings, ok: !blocked, blocked };
  }

  /**
   * Throw {@link SmsComplianceError} if the message is not ready (has a block
   * finding). Returns the report otherwise. Wire this into a send pipeline as a
   * pre-send guard.
   */
  function assertReady(message: SmsMessage, sender?: OwnedSender): A2PReadinessReport {
    const report = checkMessage(message, sender);
    if (report.blocked) {
      const reasons = report.findings.filter((f) => f.severity === "block").map((f) => f.message).join("; ");
      throw new SmsComplianceError(`A2PCheck readiness failed: ${reasons}`, "blocked_by_compliance", {
        details: report.findings,
      });
    }
    return report;
  }

  return { checkMessage, assertReady };
}

export type A2PCheckReadiness = ReturnType<typeof a2pcheckReadiness>;
