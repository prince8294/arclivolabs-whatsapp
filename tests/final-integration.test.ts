import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { middleware } from "../middleware";
import { percentage, safeCsvCell } from "../lib/analytics/reporting";
import { hasActiveCustomerServiceWindow, hasRequiredTemplateVariables, normalizeImportedConsent, parsePersonalizedRows, renderApprovedTemplate } from "../lib/campaigns/personalized";
import { normalizedRedisUrl, sendJobId } from "../lib/campaigns/queue";
import { templateMatchesCategory, templatesForCategory } from "../lib/campaigns/template-category";
import { normalizePhoneNumber } from "../lib/contacts/validation";
import { evaluatePersonalizedRows, type PersonalizedPolicyContact, type PersonalizedPolicyRow } from "../lib/campaigns/personalized-policy";
import { canDispatchRecipient, canStartCampaign } from "../lib/campaigns/dispatch-policy";
import { buildTemplateSendComponents } from "../lib/campaigns/template-components";
import { supportedTemplateComponents } from "../lib/campaigns/meta-templates";

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

test("campaign templates are restricted to the selected business category", () => {
  const templates = [
    { _id: "school-template", businessCategoryId: "school" },
    { _id: "gym-template", businessCategoryId: "gym" },
    { _id: "unassigned-template", businessCategoryId: "" }
  ];
  assert.deepEqual(templatesForCategory(templates, "gym").map((template) => template._id), ["gym-template"]);
  assert.equal(templateMatchesCategory(templates[1], "gym"), true);
  assert.equal(templateMatchesCategory(templates[0], "gym"), false);
  assert.deepEqual(templatesForCategory(templates, ""), []);
});

const categoryId = new Types.ObjectId();
const policyCategory = { id: String(categoryId), name: "Gym" };
const policyTemplate = {
  _id: new Types.ObjectId(),
  name: "gym_marketing",
  language: "en",
  body: "Hello {{1}}, try {{2}} to get {{3}}.",
  header: "",
  footer: "",
  buttons: [],
  variables: [1, 2, 3]
};
const consentContact = (phoneNumber: string, overrides: Partial<PersonalizedPolicyContact> = {}): PersonalizedPolicyContact => ({
  _id: new Types.ObjectId(),
  businessName: "Gym",
  phoneNumber,
  categoryId,
  city: "Patna",
  marketingConsentStatus: "Opted In",
  consentSource: "Website signup",
  consentTimestamp: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides
});
const policyRow = (phoneNumber: string, overrides: Partial<PersonalizedPolicyRow> = {}): PersonalizedPolicyRow => ({
  row: 2,
  businessName: "Peak Fitness",
  phoneNumber,
  category: "Gym",
  city: "Patna",
  recommendedSolution: "local ads",
  businessBenefit: "more memberships",
  templateVariables: ["Peak Fitness", "local ads", "more memberships"],
  consentStatus: "Unknown",
  consentSource: "",
  consentDate: "",
  ...overrides
});
const evaluateRows = (
  rows: PersonalizedPolicyRow[],
  contactByPhone: Map<string, PersonalizedPolicyContact>,
  recorded = new Map<string, { type: string; campaignId: string; recordId: string }>(),
  suppressions = new Set<string>()
) => evaluatePersonalizedRows(rows, policyCategory, policyTemplate, contactByPhone, suppressions, recorded);

test("duplicate rows retain only the first eligible E.164 recipient", () => {
  const phone = "+919876543210";
  const rows = evaluateRows(
    [policyRow(phone), policyRow("98765 43210", { row: 3 })],
    new Map([[phone, consentContact(phone)]])
  ).rows;
  assert.equal(rows[0].eligible, true);
  assert.equal(rows[1].eligible, false);
  assert.equal(rows[1].duplicateType, "within_csv");
  assert.equal(rows[1].duplicateRecordId, "2");
});

test("Indian phone formats normalize to the same E.164 recipient", () => {
  assert.equal(normalizePhoneNumber("9876543210"), "+919876543210");
  assert.equal(normalizePhoneNumber("919876543210"), "+919876543210");
  assert.equal(normalizePhoneNumber("+91 98765 43210"), "+919876543210");
});

test("a recipient previously contacted in another campaign is excluded with its campaign reference", () => {
  const phone = "+919876543210";
  const rows = evaluateRows(
    [policyRow(phone)],
    new Map([[phone, consentContact(phone)]]),
    new Map([[phone, { type: "previous_campaign", campaignId: "campaign-123", recordId: "recipient-456" }]])
  ).rows;
  assert.equal(rows[0].eligibilityStatus, "Duplicate Contact");
  assert.equal(rows[0].duplicateCampaignId, "campaign-123");
  assert.equal(rows[0].duplicateRecordId, "recipient-456");
});

test("a recipient reserved by another queued campaign is excluded", () => {
  const phone = "+919876543210";
  const rows = evaluateRows(
    [policyRow(phone)],
    new Map([[phone, consentContact(phone)]]),
    new Map([[phone, { type: "already_reserved", campaignId: "queued-campaign", recordId: "reservation-456" }]])
  ).rows;
  assert.equal(rows[0].eligibilityStatus, "Duplicate Contact");
  assert.equal(rows[0].duplicateType, "already_reserved");
});

test("missing business name or any required template value is excluded", () => {
  const phone = "+919876543210";
  const rows = evaluateRows(
    [
      policyRow(phone, { businessName: "" }),
      policyRow("+919876543211", { row: 3, recommendedSolution: "", templateVariables: ["Business", "", "Benefit"] })
    ],
    new Map([
      [phone, consentContact(phone)],
      ["+919876543211", consentContact("+919876543211")]
    ])
  ).rows;
  assert.equal(rows[0].eligibilityStatus, "Missing Variable");
  assert.equal(rows[1].eligibilityStatus, "Missing Variable");
});

test("a row in a different category is never eligible for the selected campaign", () => {
  const phone = "+919876543210";
  const rows = evaluateRows(
    [policyRow(phone, { category: "Hotel" })],
    new Map([[phone, consentContact(phone)]])
  ).rows;
  assert.equal(rows[0].eligibilityStatus, "Wrong Category");
});

test("invalid numbers and CSV-only consent claims are excluded", () => {
  const rows = evaluateRows([
    policyRow("not a phone", { consentStatus: "Opted In", consentSource: "Website", consentDate: "2026-01-01" }),
    policyRow("+919876543210", { row: 3, consentStatus: "Opted In", consentSource: "Website", consentDate: "2026-01-01" })
  ], new Map()).rows;
  assert.equal(rows[0].eligibilityStatus, "Invalid Number");
  assert.equal(rows[1].eligibilityStatus, "Missing Consent");
});

test("a recipient opting out after preview fails current eligibility", () => {
  const phone = "+919876543210";
  const row = policyRow(phone);
  const before = evaluateRows([row], new Map([[phone, consentContact(phone)]]));
  assert.equal(before.rows[0].eligible, true);
  const after = evaluateRows(
    [row],
    new Map([[phone, consentContact(phone, { marketingConsentStatus: "Opted Out" })]]),
    new Map(),
    new Set([phone])
  );
  assert.equal(after.rows[0].eligible, false);
  assert.equal(after.rows[0].eligibilityStatus, "Opted Out");
});

test("a stored Do Not Contact flag excludes an otherwise opted-in contact", () => {
  const phone = "+919876543210";
  const rows = evaluateRows(
    [policyRow(phone)],
    new Map([[phone, consentContact(phone, { doNotContact: true })]])
  ).rows;
  assert.equal(rows[0].eligible, false);
  assert.equal(rows[0].eligibilityStatus, "Suppressed");
});

test("repeated starts and worker retries cannot dispatch an already claimed recipient", () => {
  assert.equal(canStartCampaign("Draft"), true);
  assert.equal(canStartCampaign("Queued"), false);
  assert.equal(canDispatchRecipient("queued", true), true);
  assert.equal(canDispatchRecipient("processing", true), false);
  assert.equal(canDispatchRecipient("queued", false), false);
  assert.equal(sendJobId("recipient-id", 1), sendJobId("recipient-id", 1));
});

test("two businesses render distinct messages from approved-template variables", () => {
  const phones = ["+919876543210", "+919876543211"];
  const result = evaluateRows(
    [
      policyRow(phones[0]),
      policyRow(phones[1], {
        row: 3,
        businessName: "Lift Studio",
        recommendedSolution: "member referrals",
        businessBenefit: "retained clients",
        templateVariables: ["Lift Studio", "member referrals", "retained clients"]
      })
    ],
    new Map(phones.map((phone) => [phone, consentContact(phone)]))
  );
  assert.equal(result.rows[0].renderedMessage, "Hello Peak Fitness, try local ads to get more memberships.");
  assert.equal(result.rows[1].renderedMessage, "Hello Lift Studio, try member referrals to get retained clients.");
});

test("snake-case and common CSV aliases are normalized before preview", () => {
  const parsed = parsePersonalizedRows([{
    business_name: "Lotus Salon",
    mobile: "+919876543210",
    category: "Salon",
    recommended_solution: "appointment automation",
    business_benefit: "fewer missed bookings",
    consent_status: "Opted In",
    consent_source: "CSV"
  }]);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows[0].businessName, "Lotus Salon");
  assert.equal(parsed.rows[0].phoneNumber, "+919876543210");
  assert.equal(parsed.rows[0].templateVariables[1], "appointment automation");
  assert.equal(parsed.rows[0].templateVariables[2], "fewer missed bookings");
});

test("approved template header, body, and dynamic URL button use only their declared parameters", () => {
  assert.deepEqual(buildTemplateSendComponents({
    header: "Hello {{1}}",
    body: "Use {{2}}",
    buttons: [
      { type: "URL", url: "https://arclivolabs.com/{{3}}" },
      { type: "QUICK_REPLY" }
    ]
  }, ["Business", "solution", "ref"]), [
    { type: "header", parameters: [{ type: "text", text: "Business" }] },
    { type: "body", parameters: [{ type: "text", text: "solution" }] },
    {
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "ref" }]
    }
  ]);
});

test("approved image-header template includes its Meta media URL in the send payload", () => {
  assert.deepEqual(buildTemplateSendComponents({
    header: "",
    headerFormat: "IMAGE",
    headerMediaUrl: "https://example.com/gym-offer.jpg",
    body: "Hello {{1}}",
    buttons: []
  }, ["Peak Fitness"]), [
    {
      type: "header",
      parameters: [{ type: "image", image: { link: "https://example.com/gym-offer.jpg" } }]
    },
    { type: "body", parameters: [{ type: "text", text: "Peak Fitness" }] }
  ]);
});

test("approved Meta image-header template remains eligible for campaign selection", () => {
  assert.deepEqual(supportedTemplateComponents([
    {
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: ["https://example.com/gym-offer.jpg"] }
    },
    { type: "BODY", text: "Hello {{1}}" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "URL", text: "Visit website", url: "https://arclivolabs.com" },
        { type: "QUICK_REPLY", text: "YES" },
        { type: "QUICK_REPLY", text: "NO" }
      ]
    }
  ]), {
    body: "Hello {{1}}",
    header: "",
    headerFormat: "IMAGE",
    headerMediaUrl: "https://example.com/gym-offer.jpg",
    footer: "",
    buttons: [
      { type: "URL", text: "Visit website", url: "https://arclivolabs.com" },
      { type: "QUICK_REPLY", text: "YES" },
      { type: "QUICK_REPLY", text: "NO" }
    ]
  });
});

test("CSV upload-to-preview dry run produces eligible personalized rows without queue or Meta calls", () => {
  const firstPhone = "+919876543210";
  const secondPhone = "+919876543211";
  const parsed = parsePersonalizedRows([
    {
      business_name: "Peak Fitness",
      phone: firstPhone,
      category: "Gym",
      recommended_solution: "local ads",
      business_benefit: "more memberships"
    },
    {
      business_name: "Lift Studio",
      phone: secondPhone,
      category: "Gym",
      recommended_solution: "member referrals",
      business_benefit: "retained clients"
    }
  ]);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const preview = evaluateRows(
    parsed.rows,
    new Map([
      [firstPhone, consentContact(firstPhone)],
      [secondPhone, consentContact(secondPhone)]
    ])
  );
  assert.equal(preview.summary.eligibleContacts, 2);
  assert.equal(preview.rows[0].renderedMessage, "Hello Peak Fitness, try local ads to get more memberships.");
  assert.equal(preview.rows[1].renderedMessage, "Hello Lift Studio, try member referrals to get retained clients.");
});
