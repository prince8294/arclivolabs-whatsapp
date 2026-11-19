import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { percentage, safeCsvCell } from "../lib/analytics/reporting";
import { hasActiveCustomerServiceWindow, hasRequiredTemplateVariables, normalizeImportedConsent, parsePersonalizedRows, renderApprovedTemplate } from "../lib/campaigns/personalized";
import { normalizedRedisUrl, sendJobId } from "../lib/campaigns/queue";

const originalAdminEmail = process.env.ADMIN_EMAIL;
const originalAuthSecret = process.env.AUTH_SECRET;
const testEmail = "admin@example.com";
const testSecret = "0123456789abcdef0123456789abcdef";

before(() => {
  process.env.ADMIN_EMAIL = testEmail;
  process.env.AUTH_SECRET = testSecret;
});

after(() => {
  if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = originalAdminEmail;
  if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalAuthSecret;
});

function requestWithSession(expiresAt: number, tamperSignature = false) {
  const payload = Buffer.from(JSON.stringify({ email: testEmail, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", testSecret).update(payload).digest("base64url");
  const invalidSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  const token = `${payload}.${tamperSignature ? invalidSignature : signature}`;
  return new NextRequest("https://crm.arclivolabs.com/dashboard/analytics", {
    headers: { cookie: `arclivo_admin_session=${token}` }
  });
}

test("page middleware redirects requests without a session", async () => {
  const response = await middleware(new NextRequest("https://crm.arclivolabs.com/dashboard"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://crm.arclivolabs.com/login");
});

test("page middleware accepts a valid signed, unexpired admin session", async () => {
  const response = await middleware(requestWithSession(Math.floor(Date.now() / 1000) + 60));
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("page middleware rejects expired and tampered sessions", async () => {
  const expired = await middleware(requestWithSession(Math.floor(Date.now() / 1000) - 1));
  const tampered = await middleware(requestWithSession(Math.floor(Date.now() / 1000) + 60, true));
  assert.equal(expired.status, 307);
  assert.equal(tampered.status, 307);
});

test("report helpers avoid invalid zero-denominator rates and spreadsheet formulas", () => {
  assert.equal(percentage(0, 0), null);
  assert.equal(percentage(1, 4), 25);
  assert.equal(safeCsvCell("=HYPERLINK(\"https://example.com\")"), "\"'=HYPERLINK(\"\"https://example.com\"\")\"");
  assert.equal(safeCsvCell("ArclivoLabs"), "\"ArclivoLabs\"");
});

test("personalized CSV parsing preserves 100 distinct exact messages", () => {
  const source = Array.from({ length: 100 }, (_, index) => ({
    businessName: `Business ${index + 1}`,
    phoneNumber: `+91987654${String(index).padStart(4, "0")}`,
    category: index % 2 ? "Restaurant" : "School",
    city: index % 3 ? "Patna" : "Delhi",
    message: `  Exact personalized message ${index + 1}\nSecond line  `,
    templateVariable1: `Value ${index + 1}`,
    consentStatus: "Opted In",
    consentSource: "Test form",
    consentDate: "2026-01-01"
  }));
  const parsed = parsePersonalizedRows(source);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows.length, 100);
  assert.equal(new Set(parsed.rows.map((row) => row.message)).size, 100);
  assert.equal(parsed.rows[0].message, "  Exact personalized message 1\nSecond line  ");
});

test("approved templates resolve variables without changing the approved structure", () => {
  assert.equal(
    renderApprovedTemplate("Hello {{1}}, ArclivoLabs can help {{2}} with {{3}}.", ["Priya", "ABC School", "admissions promotion"]),
    "Hello Priya, ArclivoLabs can help ABC School with admissions promotion."
  );
  assert.equal(normalizeImportedConsent("opted_in"), "Opted In");
  assert.equal(normalizeImportedConsent(""), "Unknown");
});

test("free-form windows and required template variables are evaluated per recipient", () => {
  const now = new Date("2026-11-18T12:00:00.000Z").getTime();
  assert.equal(hasActiveCustomerServiceWindow(new Date(now - 23 * 60 * 60 * 1000), now), true);
  assert.equal(hasActiveCustomerServiceWindow(new Date(now - 24 * 60 * 60 * 1000), now), false);
  assert.equal(hasActiveCustomerServiceWindow(new Date(now + 1000), now), false);
  assert.equal(hasRequiredTemplateVariables("Hello {{1}}, help {{2}} with {{3}}", ["ABC", "School", "Admissions"]), true);
  assert.equal(hasRequiredTemplateVariables("Hello {{1}}, help {{2}} with {{3}}", ["ABC", "", "Admissions"]), false);
});

test("Redis configuration accepts TLS URLs and safely extracts the URL from an Upstash CLI command", () => {
  assert.equal(
    normalizedRedisUrl("rediss://default:secret@example.upstash.io:6379"),
    "rediss://default:secret@example.upstash.io:6379"
  );
  assert.equal(
    normalizedRedisUrl("redis-cli --tls -u redis://default:secret@example.upstash.io:6379"),
    "rediss://default:secret@example.upstash.io:6379"
  );
  assert.throws(() => normalizedRedisUrl("redis-cli --tls example.upstash.io"), /REDIS_URL/);
});

test("recipient queue job IDs are deterministic across recovery runs", () => {
  assert.equal(sendJobId("recipient-id", 1), sendJobId("recipient-id", 1));
  assert.notEqual(sendJobId("recipient-id", 1), sendJobId("recipient-id", 2));
});
