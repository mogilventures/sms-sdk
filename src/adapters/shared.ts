import type { InboundWebhookInput } from "../types.js";

/**
 * Extract a flat key/value payload from an inbound webhook wrapper.
 * Handles: already-parsed `body` objects, form-encoded `rawBody`, and JSON
 * `rawBody`. Falls back to an empty object.
 */
export function extractPayload(input: InboundWebhookInput): Record<string, unknown> {
  if (input.body && typeof input.body === "object") return input.body as Record<string, unknown>;
  if (typeof input.rawBody === "string" && input.rawBody.length) {
    const trimmed = input.rawBody.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        /* fall through to form parsing */
      }
    }
    const params = new URLSearchParams(input.rawBody);
    return Object.fromEntries(params.entries());
  }
  if (input.body && typeof input.body === "string") {
    try {
      return JSON.parse(input.body) as Record<string, unknown>;
    } catch {
      return Object.fromEntries(new URLSearchParams(input.body).entries());
    }
  }
  return {};
}

export function str(value: unknown): string {
  return value == null ? "" : String(value);
}

/** Minimal fetch type so adapters can accept a mock without DOM lib types. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function resolveFetch(custom?: FetchLike): FetchLike {
  const f = custom ?? (globalThis.fetch as FetchLike | undefined);
  if (!f) {
    throw new Error("global fetch is unavailable; pass a `fetch` implementation in adapter config (Node >= 18 required).");
  }
  return f;
}
