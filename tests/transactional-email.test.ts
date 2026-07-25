import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// RZ-AUDIT H-6: before this, a customer who paid received nothing at all — the
// email_outbox table existed but only the newsletter ever wrote to it, and the
// dispatcher posted to a generic provider webhook that was never configured.

import { STORE_IDENTITY_FALLBACK } from "@/features/store/identity";

type TableCall = { method: string; args: unknown[] };
type TableResult = { data: unknown; error: unknown };

const allCalls: Array<{ table: string; method: string; args: unknown[] }> = [];
let outboxRows: unknown[] = [];
const updates: Array<Record<string, unknown>> = [];

function createQueryBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const callLog: TableCall[] = [];
  for (const method of ["select", "eq", "in", "lte", "order", "limit", "update", "insert"]) {
    builder[method] = (...args: unknown[]) => {
      if (method === "update") updates.push(args[0] as Record<string, unknown>);
      callLog.push({ method, args });
      allCalls.push({ table, method, args });
      return builder;
    };
  }
  const resolve = (): TableResult => {
    // The claim step (`update(...).select().maybeSingle()`) must report success so
    // the row proceeds to a send; the initial list query returns the queued rows.
    if (callLog.some((c) => c.method === "update")) return { data: { id: "row-1" }, error: null };
    return { data: outboxRows, error: null };
  };
  builder.maybeSingle = () => Promise.resolve(resolve());
  builder.single = () => Promise.resolve(resolve());
  builder.then = (onFulfilled?: (v: TableResult) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: (table: string) => createQueryBuilder(table) }),
}));

vi.mock("@/features/store/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/store/identity")>();
  return { ...actual, getStoreIdentity: async () => actual.STORE_IDENTITY_FALLBACK };
});

const { dispatchEmailOutbox } = await import("@/features/email/service");
const { renderEmail } = await import("@/features/email/templates");

const ORDER_PAYLOAD = {
  orderNumber: "CD-010001",
  customerName: "Asha",
  currency: "INR",
  totalMinor: 249900,
  items: [{ name: "Cherry Tote", quantity: 2, lineTotalMinor: 199900 }],
};

const originalEnv = { ...process.env };
const fetchMock = vi.fn();

beforeEach(() => {
  allCalls.length = 0;
  updates.length = 0;
  outboxRows = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.RESEND_API_KEY = "re_test_key_0123456789";
  process.env.EMAIL_FROM_ADDRESS = "Cherry Doodle <orders@cherrydoodle.in>";
  delete process.env.EMAIL_REPLY_TO_ADDRESS;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

function queued(overrides: Record<string, unknown> = {}) {
  return [{ id: "row-1", message_type: "order_confirmation", recipient_email: "asha@example.com", payload: ORDER_PAYLOAD, attempts: 0, ...overrides }];
}

function resendOk() {
  return { ok: true, status: 200, json: async () => ({ id: "resend-id" }) } as Response;
}

describe("order confirmation template", () => {
  it("renders the order number, line items and total in both HTML and text", () => {
    const rendered = renderEmail("order_confirmation", ORDER_PAYLOAD, STORE_IDENTITY_FALLBACK);
    expect(rendered).not.toBeNull();
    expect(rendered!.subject).toContain("CD-010001");
    expect(rendered!.html).toContain("Cherry Tote");
    expect(rendered!.text).toContain("CD-010001");
    // A text/plain alternative materially helps deliverability on a new domain.
    expect(rendered!.text).toContain("Cherry Tote");
  });

  it("escapes attacker-influenceable values instead of injecting markup", () => {
    const rendered = renderEmail(
      "order_confirmation",
      { ...ORDER_PAYLOAD, customerName: '<img src=x onerror="alert(1)">' },
      STORE_IDENTITY_FALLBACK,
    );
    expect(rendered!.html).not.toContain("<img");
    expect(rendered!.html).toContain("&lt;img");
  });

  it("returns null for a message type with no template", () => {
    expect(renderEmail("something_unknown", {}, STORE_IDENTITY_FALLBACK)).toBeNull();
  });

  it("refuses to turn a non-http scheme into a link", () => {
    const rendered = renderEmail(
      "newsletter_confirmation",
      { confirmUrl: "javascript:alert(1)" },
      STORE_IDENTITY_FALLBACK,
    );
    expect(rendered).toBeNull();
  });
});

describe("outbox dispatch through Resend", () => {
  it("sends a queued order confirmation and marks the row sent", async () => {
    outboxRows = queued();
    fetchMock.mockResolvedValue(resendOk());

    const result = await dispatchEmailOutbox();

    expect(result).toMatchObject({ sent: 1, failed: 0, abandoned: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_key_0123456789");
    // Guards the window where the send succeeds but our status write does not.
    expect(headers["idempotency-key"]).toBe("order_confirmation/row-1");
    const body = JSON.parse(String(init.body)) as { from: string; to: string[]; text: string };
    expect(body.from).toBe("Cherry Doodle <orders@cherrydoodle.in>");
    expect(body.to).toEqual(["asha@example.com"]);
    expect(updates.at(-1)).toMatchObject({ status: "sent" });
  });

  it("retries a transient provider failure with backoff", async () => {
    outboxRows = queued();
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ message: "upstream" }) } as Response);

    const result = await dispatchEmailOutbox();

    expect(result).toMatchObject({ sent: 0, failed: 1, abandoned: 0 });
    const final = updates.at(-1) as { status: string; attempts: number; next_attempt_at: string };
    expect(final.status).toBe("failed");
    expect(final.attempts).toBe(1);
    expect(new Date(final.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
  });

  // A revoked API key will be rejected identically on every future run; retrying it
  // burns a slot forever and hides the real queue behind a poison message.
  it("stops retrying a permanently rejected message", async () => {
    outboxRows = queued();
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "API key is invalid" }) } as Response);

    const result = await dispatchEmailOutbox();

    expect(result).toMatchObject({ sent: 0, abandoned: 1 });
    const final = updates.at(-1) as { last_error: string; next_attempt_at: string };
    expect(final.last_error).toContain("PERMANENT");
    expect(new Date(final.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 86_400_000);
  });

  // Resend answers 403 while the sending domain is still unverified. Treating that
  // as permanent would irreversibly drop the confirmation for every order placed
  // between deploy and DNS propagation, so it must stay retryable.
  it("keeps retrying while the sending domain is still unverified", async () => {
    outboxRows = queued();
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: "The cherrydoodle.in domain is not verified" }) } as Response);

    const result = await dispatchEmailOutbox();

    expect(result).toMatchObject({ sent: 0, failed: 1, abandoned: 0 });
    const final = updates.at(-1) as { last_error: string; next_attempt_at: string };
    expect(final.last_error).not.toContain("PERMANENT");
    expect(new Date(final.next_attempt_at).getTime()).toBeLessThan(Date.now() + 86_400_000);
  });

  it("abandons a row whose message type has no template instead of sending nothing forever", async () => {
    outboxRows = queued({ message_type: "legacy_unknown_type" });

    const result = await dispatchEmailOutbox();

    expect(result).toMatchObject({ abandoned: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing (and does not call the provider) when the queue is empty", async () => {
    outboxRows = [];
    const result = await dispatchEmailOutbox();
    expect(result).toEqual({ sent: 0, failed: 0, abandoned: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
