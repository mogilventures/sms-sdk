import { describe, expect, it, vi } from "vitest";
import { createSmsClient, createSenderRegistry } from "../src/index.js";
import { createTwilioAdapter } from "../src/adapters/twilio.js";
import { createTelnyxAdapter } from "../src/adapters/telnyx.js";
import { createPlivoAdapter } from "../src/adapters/plivo.js";
import { createSnsAdapter } from "../src/adapters/sns.js";

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

const textResponse = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: init.status ?? 200, headers: init.headers });

const headerRecord = (init: RequestInit) => init.headers as Record<string, string>;
const bodyString = (init: RequestInit) => String(init.body ?? "");

describe("provider adapters", () => {
  it("maps Twilio send requests to Messages API form fields", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        sid: "SM123",
        status: "queued",
        from: "+15550100100",
        to: "+15559999999",
        num_segments: "1",
        price: "-0.0075",
        price_unit: "USD",
      }),
    );
    const adapter = createTwilioAdapter({ accountSid: "AC123", authToken: "token", statusCallbackUrl: "https://example.com/status", fetch });

    const result = await adapter.send({
      from: "+15550100100",
      to: "+15559999999",
      body: "hello",
      mediaUrls: ["https://example.com/a.png"],
      idempotencyKey: "idem-1",
      senderId: "primary",
    });

    expect(result).toMatchObject({ provider: "twilio", messageId: "SM123", from: "+15550100100", to: "+15559999999" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/2010-04-01/Accounts/AC123/Messages.json");
    expect(init.method).toBe("POST");
    expect(headerRecord(init)["Idempotency-Key"]).toBe("idem-1");
    const params = new URLSearchParams(bodyString(init));
    expect(params.get("From")).toBe("+15550100100");
    expect(params.get("To")).toBe("+15559999999");
    expect(params.get("Body")).toBe("hello");
    expect(params.get("StatusCallback")).toBe("https://example.com/status");
    expect(params.getAll("MediaUrl")).toEqual(["https://example.com/a.png"]);
  });

  it("maps Telnyx send requests to v2 JSON payload", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        data: {
          id: "msg-1",
          from: { phone_number: "+15550100200" },
          to: [{ phone_number: "+15559999999", status: "queued" }],
          parts: 1,
          cost: { amount: "0.004", currency: "USD" },
        },
      }),
    );
    const telnyxKey = "telnyx-test-key";
    const adapter = createTelnyxAdapter({ apiKey: telnyxKey, messagingProfileId: "profile-1", fetch });
    await adapter.send({ from: "+15550100200", to: "+15559999999", body: "hello", senderId: "telnyx" });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telnyx.com/v2/messages");
    const payload = JSON.parse(bodyString(init));
    expect(payload).toMatchObject({ from: "+15550100200", to: "+15559999999", text: "hello", messaging_profile_id: "profile-1" });
  });

  it("maps Plivo send requests to Message API JSON payload", async () => {
    const fetch = vi.fn(async () => jsonResponse({ message_uuid: ["uuid-1"] }, { status: 202 }));
    const adapter = createPlivoAdapter({ authId: "auth", authToken: "token", callbackUrl: "https://example.com/plivo", fetch });
    const result = await adapter.send({ from: "+15550100300", to: "+15559999999", body: "hello", senderId: "plivo" });

    expect(result.messageId).toBe("uuid-1");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.plivo.com/v1/Account/auth/Message/");
    expect(JSON.parse(bodyString(init))).toMatchObject({ src: "+15550100300", dst: "+15559999999", text: "hello", type: "sms", url: "https://example.com/plivo" });
  });

  it("maps SNS publish request with origination number attribute", async () => {
    const fetch = vi.fn(async () =>
      textResponse("<PublishResponse><PublishResult><MessageId>sns-1</MessageId></PublishResult></PublishResponse>"),
    );
    const adapter = createSnsAdapter({
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      region: "us-east-1",
      now: () => new Date("2026-06-23T16:00:00.000Z"),
      fetch,
    });

    const result = await adapter.send({ from: "+15550100400", to: "+15559999999", body: "hello", senderId: "sns" });
    expect(result).toMatchObject({ provider: "sns", messageId: "sns-1", status: "accepted" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sns.us-east-1.amazonaws.com/");
    const params = new URLSearchParams(bodyString(init));
    expect(params.get("Action")).toBe("Publish");
    expect(params.get("PhoneNumber")).toBe("+15559999999");
    expect(params.get("Message")).toBe("hello");
    expect([...params.values()]).toContain("+15550100400");
  });

  it("normalizes inbound events and resolves them to an owned sender", () => {
    const adapter = createTwilioAdapter({ accountSid: "AC123", authToken: "token", fetch: vi.fn() });
    const registry = createSenderRegistry([{ id: "inbox", phoneNumber: "+15550100100", provider: "twilio" }]);
    const client = createSmsClient({ adapters: [adapter], senderRegistry: registry });

    const event = client.parseInbound("twilio", {
      body: {
        MessageSid: "SM_IN",
        From: "+15559999999",
        To: "+15550100100",
        Body: "STOP",
        NumMedia: "1",
        MediaUrl0: "https://example.com/media.jpg",
      },
    });

    expect(event).toMatchObject({ provider: "twilio", messageId: "SM_IN", from: "+15559999999", to: "+15550100100", body: "STOP" });
    expect(event.mediaUrls).toEqual(["https://example.com/media.jpg"]);
    expect(client.resolveInbound(event)?.id).toBe("inbox");
  });
});
