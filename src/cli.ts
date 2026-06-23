#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createSmsClient } from "./client.js";
import { createSenderRegistry } from "./sender-registry.js";
import { validateMessage } from "./validate.js";
import { SmsSdkError } from "./errors.js";
import { createMemoryAdapter } from "./adapters/memory.js";
import { createTwilioAdapter } from "./adapters/twilio.js";
import { createTelnyxAdapter } from "./adapters/telnyx.js";
import { createPlivoAdapter } from "./adapters/plivo.js";
import { createSnsAdapter } from "./adapters/sns.js";
import type { SmsAdapter, InboundWebhookInput } from "./types.js";

interface CliResult {
  code: number;
  out: string;
}

const noopFetch = async () => {
  throw new SmsSdkError("network disabled in CLI", "transient_provider_error");
};

/** Provider -> required env vars for `doctor` and credential checks. */
const PROVIDER_ENV: Record<string, string[]> = {
  twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  telnyx: ["TELNYX_API_KEY"],
  plivo: ["PLIVO_AUTH_ID", "PLIVO_AUTH_TOKEN"],
  sns: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
};

/** Build an adapter with placeholder creds for capability/parse-only use. */
function inertAdapter(provider: string): SmsAdapter {
  switch (provider) {
    case "memory":
      return createMemoryAdapter();
    case "twilio":
      return createTwilioAdapter({ accountSid: "AC_inert", authToken: "x", fetch: noopFetch });
    case "telnyx":
      return createTelnyxAdapter({ apiKey: "x", fetch: noopFetch });
    case "plivo":
      return createPlivoAdapter({ authId: "x", authToken: "x", fetch: noopFetch });
    case "sns":
      return createSnsAdapter({ accessKeyId: "x", secretAccessKey: "x", region: "us-east-1", fetch: noopFetch });
    default:
      throw new SmsSdkError(`Unknown provider "${provider}"`, "provider_not_found");
  }
}

function parseArgs(argv: string[]): { _: string[]; flags: Record<string, string | boolean> } {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

const PROVIDERS = ["memory", "twilio", "telnyx", "plivo", "sns"];

const HELP = `sms-sdk — A2P transactional SMS toolkit

Usage: sms-sdk <command> [options]

Commands:
  adapters                       List built-in adapters and their capabilities
  doctor                         Check runtime + provider credential env vars
  validate --to <e164> --body <text> [--require-consent] [--json <msg>]
                                 Validate a message; prints warnings/errors
  test-send --to <e164> [--from <e164>] --body <text>
                                 Dry-run a send through the in-memory adapter
  inbound-parse --provider <p> (--json <payload> | --raw <formstring>)
                                 Parse a webhook payload into a normalized event

Run with no credentials: adapters, validate, test-send, inbound-parse all work
offline. doctor reports which provider env vars are present.`;

function flagStr(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<CliResult> {
  const { _, flags } = parseArgs(argv);
  const cmd = _[0];

  if (!cmd || flags.help || cmd === "help") {
    return { code: cmd ? 0 : 1, out: HELP };
  }

  try {
    switch (cmd) {
      case "adapters": {
        const rows = PROVIDERS.map((p) => ({ name: p, capabilities: inertAdapter(p).capabilities }));
        return { code: 0, out: JSON.stringify(rows, null, 2) };
      }

      case "doctor": {
        const lines: string[] = [];
        const major = Number(process.versions.node.split(".")[0]);
        lines.push(`node: ${process.versions.node} ${major >= 18 ? "OK" : "FAIL (need >=18)"}`);
        lines.push(`global fetch: ${typeof globalThis.fetch === "function" ? "OK" : "MISSING (need Node >=18)"}`);
        lines.push("");
        lines.push("provider credentials:");
        for (const [provider, vars] of Object.entries(PROVIDER_ENV)) {
          const missing = vars.filter((v) => !env[v]);
          const status = missing.length === 0 ? "ready" : `missing: ${missing.join(", ")}`;
          lines.push(`  ${provider.padEnd(7)} ${status}`);
        }
        const ok = major >= 18 && typeof globalThis.fetch === "function";
        return { code: ok ? 0 : 1, out: lines.join("\n") };
      }

      case "validate": {
        const message = flagStr(flags.json)
          ? JSON.parse(flagStr(flags.json)!)
          : { to: flagStr(flags.to), body: flagStr(flags.body) };
        try {
          const { warnings } = validateMessage(message, { requireConsent: Boolean(flags["require-consent"]) });
          const out = ["valid: true", ...warnings.map((w) => `warning: ${w}`)].join("\n");
          return { code: 0, out };
        } catch (err) {
          return { code: 1, out: `valid: false\nerror: ${(err as Error).message}` };
        }
      }

      case "test-send": {
        const to = flagStr(flags.to);
        const body = flagStr(flags.body);
        if (!to || !body) return { code: 1, out: "test-send requires --to and --body" };
        const from = flagStr(flags.from) ?? "+15555550100";
        const memory = createMemoryAdapter();
        const registry = createSenderRegistry([
          { id: "cli", phoneNumber: from, provider: "memory" },
        ]);
        const client = createSmsClient({ adapters: [memory], senderRegistry: registry, defaultSender: "cli" });
        const result = await client.send({ to, body, from: "cli" });
        return { code: 0, out: JSON.stringify({ dryRun: true, result }, null, 2) };
      }

      case "inbound-parse": {
        const provider = flagStr(flags.provider);
        if (!provider) return { code: 1, out: "inbound-parse requires --provider" };
        const adapter = inertAdapter(provider);
        const input: InboundWebhookInput = flagStr(flags.json)
          ? { body: JSON.parse(flagStr(flags.json)!) }
          : { rawBody: flagStr(flags.raw) ?? "" };
        const event = adapter.parseInboundWebhook(input);
        return { code: 0, out: JSON.stringify(event, null, 2) };
      }

      default:
        return { code: 1, out: `Unknown command "${cmd}"\n\n${HELP}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { code: 1, out: `error: ${message}` };
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli(process.argv.slice(2)).then(({ code, out }) => {
    if (out) (code === 0 ? process.stdout : process.stderr).write(out + "\n");
    process.exit(code);
  });
}
