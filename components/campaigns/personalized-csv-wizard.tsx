"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowLeft, Check, Download, FileSpreadsheet, LoaderCircle, Send, Upload, X } from "lucide-react";
import { templateMatchesCategory, templatesForCategory } from "@/lib/campaigns/template-category";

type CsvSource = Record<string, string>;
type Field =
  | "businessName"
  | "phoneNumber"
  | "category"
  | "recommendedSolution"
  | "businessBenefit"
  | "consentStatus"
  | "consentSource"
  | "consentDate";
type NormalizedRow = {
  row: number;
  businessName: string;
  phoneNumber: string;
  category: string;
  city: string;
  recommendedSolution: string;
  businessBenefit: string;
  templateVariables: string[];
  consentStatus: string;
  consentSource: string;
  consentDate: string;
};
type PreviewRow = NormalizedRow & {
  normalizedPhoneNumber: string;
  categoryName: string;
  effectiveConsentStatus: string;
  renderedMessage: string;
  eligibilityStatus: string;
  exclusionReason: string;
  duplicateType: string;
  duplicateCampaignId: string;
  duplicateRecordId: string;
  eligible: boolean;
};
type Summary = {
  totalRows: number;
  uniqueNumbers: number;
  duplicateWithinCsv: number;
  previouslyImportedOrContacted: number;
  invalidNumbers: number;
  missingTemplateData: number;
  noConsentOrOptedOut: number;
  wrongCategory: number;
  eligibleContacts: number;
  excludedContacts: number;
};
type Template = {
  _id: string;
  name: string;
  businessCategoryId: string;
  businessCategory: string;
  language: string;
  body: string;
  header: string;
  footer: string;
  variables: number[];
  buttons: { type: "QUICK_REPLY" | "URL"; text: string; url?: string }[];
};
type Category = { _id: string; name: string };
type Tab = "eligible" | "duplicates" | "excluded" | "all";

const fields: { key: Field; label: string; aliases: string[] }[] = [
  { key: "businessName", label: "Business name", aliases: ["businessname", "business", "company", "companyname", "organization", "name"] },
  { key: "phoneNumber", label: "Phone", aliases: ["phone", "phonenumber", "mobile", "mobilenumber", "number", "whatsapp", "whatsappnumber"] },
  { key: "category", label: "Category", aliases: ["category", "businesscategory", "industry"] },
  { key: "recommendedSolution", label: "Recommended solution", aliases: ["recommendedsolution", "solution", "recommendation"] },
  { key: "businessBenefit", label: "Business benefit", aliases: ["businessbenefit", "benefit"] },
  { key: "consentStatus", label: "Consent status (informational)", aliases: ["consentstatus", "marketingconsent", "consent"] },
  { key: "consentSource", label: "Consent source (informational)", aliases: ["consentsource", "permissionsource"] },
  { key: "consentDate", label: "Consent timestamp (informational)", aliases: ["consenttimestamp", "consentdate", "permissiondate"] }
];
const inputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs outline-none focus:border-[#128c50]";
const tabs: { key: Tab; label: string }[] = [
  { key: "eligible", label: "Eligible" },
  { key: "duplicates", label: "Duplicates" },
  { key: "excluded", label: "Excluded" },
  { key: "all", label: "All Records" }
];

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function downloadCsv(name: string, rows: string[][]) {
  const content = rows.map((row) => row.map((value) => {
    const protectedValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${protectedValue.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvVariableHeader(headers: string[], number: number) {
  const possible = new Set([`templatevariable${number}`, `variable${number}`, `var${number}`, `parameter${number}`]);
  return headers.find((header) => possible.has(normalizedKey(header)));
}

export function PersonalizedCsvWizard() {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "configure" | "review">("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sourceRows, setSourceRows] = useState<CsvSource[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<Field, string>>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [fullRow, setFullRow] = useState<PreviewRow | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [configurationLoaded, setConfigurationLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      try {
        const categoryResponse = await fetch("/api/categories", { cache: "no-store" });
        const categoryResult = await categoryResponse.json();
        if (!categoryResponse.ok) throw new Error(categoryResult.error?.message ?? "Categories could not be loaded.");
        if (active) setCategories(categoryResult.categories as Category[]);
        const templateResponse = await fetch("/api/campaigns/templates", { cache: "no-store" });
        const templateResult = await templateResponse.json();
        if (!templateResponse.ok) throw new Error(templateResult.error?.message ?? "Approved templates could not be loaded.");
        if (!active) return;
        setTemplates(templateResult.templates as Template[]);
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Campaign options could not be loaded.");
      } finally {
        if (active) setConfigurationLoaded(true);
      }
    }
    void loadOptions();
    return () => { active = false; };
  }, []);

  const selectedTemplate = templates.find((item) => item._id === templateId);
  const availableTemplates = useMemo(
    () => templatesForCategory(templates, selectedCategoryId),
    [templates, selectedCategoryId]
  );

  function selectCategory(categoryId: string) {
    setSelectedCategoryId(categoryId);
    setTemplateId((currentTemplateId) => {
      const current = templates.find((template) => template._id === currentTemplateId);
      return templateMatchesCategory(current, categoryId) ? currentTemplateId : "";
    });
    setPreviewRows([]);
    setSummary(null);
  }
  const normalizedRows = useMemo<NormalizedRow[]>(() => sourceRows.map((source, index) => {
    const get = (field: Field) => mapping[field] ? source[mapping[field]!] ?? "" : "";
    const businessName = get("businessName").trim();
    const recommendedSolution = get("recommendedSolution").trim();
    const businessBenefit = get("businessBenefit").trim();
    const highestVariable = Math.max(3, ...(selectedTemplate?.variables ?? [1, 2, 3]));
    const templateVariables = Array.from({ length: Math.min(highestVariable, 20) }, (_, variableIndex) => {
      if (variableIndex === 0) return businessName;
      if (variableIndex === 1) return recommendedSolution;
      if (variableIndex === 2) return businessBenefit;
      const header = csvVariableHeader(headers, variableIndex + 1);
      return header ? source[header] ?? "" : "";
    });
    return {
      row: index + 2,
      businessName,
      phoneNumber: get("phoneNumber").trim(),
      category: get("category").trim(),
      city: source.city ?? "",
      recommendedSolution,
      businessBenefit,
      templateVariables,
      consentStatus: get("consentStatus").trim(),
      consentSource: get("consentSource").trim(),
      consentDate: get("consentDate").trim()
    };
  }), [sourceRows, mapping, headers, selectedTemplate]);

  const filteredRows = previewRows.filter((row) => {
    if (tab === "eligible") return row.eligible;
    if (tab === "duplicates") return row.eligibilityStatus === "Duplicate Contact";
    if (tab === "excluded") return !row.eligible && row.eligibilityStatus !== "Duplicate Contact";
    return true;
  });

  async function parseFile(file: File) {
    setNotice("");
    if (!file.name.toLowerCase().endsWith(".csv")) { setNotice("Choose a CSV file."); return; }
    if (file.size > 4 * 1024 * 1024) { setNotice("CSV files must be 4 MB or smaller."); return; }
    setBusy(true);
    try {
      const parsed = await new Promise<Papa.ParseResult<CsvSource>>((resolve, reject) => Papa.parse<CsvSource>(file, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (value) => value.trim(),
        complete: resolve,
        error: reject
      }));
      const foundHeaders = parsed.meta.fields ?? [];
      if (!foundHeaders.length || !parsed.data.length) throw new Error("The CSV has no header or data rows.");
      if (parsed.data.length > 5000) throw new Error("CSV files may contain at most 5,000 rows.");
      const detected: Partial<Record<Field, string>> = {};
      for (const field of fields) {
        const header = foundHeaders.find((value) => field.aliases.includes(normalizedKey(value)));
        if (header) detected[field.key] = header;
      }
      setFileName(file.name);
      setHeaders(foundHeaders);
      setSourceRows(parsed.data);
      setMapping(detected);
      setName("");
      setStep("configure");
      if (parsed.errors.length) setNotice(`The CSV parser reported ${parsed.errors.length} formatting issue(s); check the preview carefully.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The CSV could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void parseFile(file);
    event.target.value = "";
  }

  async function preview() {
    if (!sourceRows.length) { setNotice("Upload a CSV file first."); return; }
    if (!mapping.businessName || !mapping.phoneNumber) { setNotice("CSV must include a business_name and phone column."); return; }
    if (!selectedCategoryId) { setNotice("Select one business category for this campaign."); return; }
    if (!templateId) { setNotice("Choose an approved Meta marketing template."); return; }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/campaigns/personalized/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "approved_template", categoryId: selectedCategoryId, templateId, rows: normalizedRows })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Preview could not be prepared.");
      setPreviewRows(result.rows as PreviewRow[]);
      setSummary(result.summary as Summary);
      setTab("all");
      setStep("review");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Preview could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  function downloadErrors() {
    const rows = previewRows.filter((row) => !row.eligible);
    downloadCsv("arclivolabs-campaign-exclusions.csv", [
      ["Row", "Business Name", "Phone", "Normalized Phone", "Status", "Duplicate Type", "Original Campaign", "Original Record", "Reason"],
      ...rows.map((row) => [
        String(row.row),
        row.businessName,
        row.phoneNumber,
        row.normalizedPhoneNumber,
        row.eligibilityStatus,
        row.duplicateType,
        row.duplicateCampaignId,
        row.duplicateRecordId,
        row.exclusionReason
      ])
    ]);
  }

  async function startCampaign() {
    setBusy(true);
    setNotice("");
    try {
      const selectedCategory = categories.find((item) => item._id === selectedCategoryId);
      const response = await fetch("/api/campaigns/personalized", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || `${selectedCategory?.name ?? "Bulk"} campaign ${new Date().toISOString().slice(0, 10)}`,
          mode: "approved_template",
          categoryId: selectedCategoryId,
          templateId,
          rows: normalizedRows,
          confirm: true
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Campaign could not be saved.");
      const startResponse = await fetch(`/api/campaigns/${result.campaignId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const startResult = await startResponse.json();
      if (!startResponse.ok) throw new Error(`${startResult.error?.message ?? "Campaign could not be queued."} The reviewed campaign remains saved as a draft.`);
      router.push(`/dashboard/bulk-messaging/${result.campaignId}`);
    } catch (error) {
      setConfirming(false);
      setNotice(error instanceof Error ? error.message : "Campaign could not be started.");
    } finally {
      setBusy(false);
    }
  }

  const selectedCategory = categories.find((item) => item._id === selectedCategoryId);
  const templateMappings = selectedTemplate?.variables.map((number) => ({
    number,
    source: number === 1 ? "business_name" : number === 2 ? "recommended_solution" : number === 3 ? "business_benefit" : csvVariableHeader(headers, number) ?? `variable_${number}`
  })) ?? [];

  return <div className="space-y-5">
    <header>
      <Link href="/dashboard/bulk-messaging" className="mb-3 inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><ArrowLeft size={14} /> Campaign history</Link>
      <h1 className="text-[24px] font-semibold tracking-[-0.04em]">Bulk Messaging</h1>
      <p className="mt-1 text-xs text-[var(--muted)]">Upload a CSV, select one category and an approved template, then review only eligible recipients.</p>
    </header>
    {notice && <div role="alert" className="flex justify-between rounded-xl border border-[var(--border)] px-4 py-3 text-xs"><span>{notice}</span><button onClick={() => setNotice("")}><X size={14} /></button></div>}
    <div className="flex gap-2 text-[10px] font-semibold">
      {[["upload", "Upload CSV"], ["configure", "Category & template"], ["review", "Preview & send"]].map(([value, label], index) =>
        <div key={value} className={`rounded-full px-3 py-1.5 ${step === value ? "bg-[#128c50] text-white" : "bg-[var(--surface-muted)] text-[var(--muted)]"}`}>{index + 1}. {label}</div>
      )}
    </div>

    {step === "upload" && <section className="surface soft-shadow max-w-2xl rounded-2xl p-5 sm:p-7">
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-8 text-center sm:p-10">
        <FileSpreadsheet className="mx-auto text-[var(--accent)]" />
        <h2 className="mt-3 text-sm font-semibold">Upload recipient CSV</h2>
        <p className="mt-1 text-[11px] text-[var(--muted)]">Up to 4 MB and 5,000 rows. Headers are matched automatically; no messages are sent before final confirmation.</p>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#128c50] px-4 py-2.5 text-xs font-semibold text-white">
          <Upload size={14} /> Choose CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={chooseFile} />
        </label>
      </div>
      <p className="mt-4 text-[10px] leading-4 text-[var(--muted)]">Required headers: <code>business_name</code> and <code>phone</code>. Optional: <code>category</code>, <code>recommended_solution</code>, <code>business_benefit</code>, and consent fields.</p>
    </section>}

    {step === "configure" && <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <section className="surface soft-shadow rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Automatic CSV mapping</h2>
        <p className="mt-1 text-[10px] text-[var(--muted)]">{fileName} · {sourceRows.length} rows · matched without changing template text.</p>
        <div className="mt-4 space-y-2">
          {fields.slice(0, 5).map((field) => <div key={field.key} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-[11px]">
            <span className="font-medium">{field.label}</span>
            <span className="max-w-[55%] truncate text-right text-[var(--muted)]">{mapping[field.key] ?? (field.key === "category" ? "Selected category" : "Not found")}</span>
          </div>)}
        </div>
        <label className="mt-4 block text-[11px] font-semibold">Campaign name <span className="font-normal text-[var(--muted)]">(optional)</span>
          <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={`${selectedCategory?.name ?? "Bulk"} campaign`} className={`mt-1 ${inputClass}`} />
        </label>
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] leading-4 text-[var(--muted)]">
          CSV consent columns are informational only. Sending requires a matching CRM contact with stored, current opt-in evidence; upload or public phone listings do not establish consent.
        </div>
      </section>
      <section className="surface soft-shadow rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Choose one category and approved template</h2>
        <label className="mt-4 block text-[11px] font-semibold">Business category
          <select value={selectedCategoryId} onChange={(event) => selectCategory(event.target.value)} className={`mt-1 ${inputClass}`}>
            <option value="">Select one category</option>
            {categories.map((category) => <option value={category._id} key={category._id}>{category.name}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-[11px] font-semibold">Approved WhatsApp marketing template
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} disabled={!selectedCategoryId || !availableTemplates.length} className={`mt-1 ${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}>
            <option value="">Select approved template</option>
            {availableTemplates.map((template) => <option value={template._id} key={template._id}>{template.name} · {template.language}</option>)}
          </select>
        </label>
        {!configurationLoaded && <p className="mt-3 text-[10px] text-[var(--muted)]">Loading connected categories and Meta-approved templates…</p>}
        {configurationLoaded && !templates.length && <p className="mt-3 text-[10px] text-amber-700">No eligible approved templates are available. Connect WhatsApp and sync a Marketing template first.</p>}
        {configurationLoaded && selectedCategoryId && templates.length > 0 && !availableTemplates.length && <p className="mt-3 text-[10px] text-amber-700">No approved Marketing template is assigned to {selectedCategory?.name ?? "this category"}. Assign the correct business category from Templates first.</p>}
        {selectedTemplate && <div className="mt-4 rounded-xl bg-[#e8eee9] p-3 text-xs text-[#172b19]">
          <p className="mb-2 text-[9px] font-semibold uppercase">Approved template preview</p>
          {selectedTemplate.header && <p className="font-semibold">{selectedTemplate.header}</p>}
          <p className="mt-1 whitespace-pre-wrap">{selectedTemplate.body}</p>
          {selectedTemplate.footer && <p className="mt-2 text-[10px]">{selectedTemplate.footer}</p>}
          {selectedTemplate.buttons.map((button, index) => <p key={`${button.text}-${index}`} className="mt-2 border-t border-[#172b19]/10 pt-2 text-[10px] font-semibold">{button.text}{button.url ? ` · ${button.url}` : ""}</p>)}
        </div>}
        {selectedTemplate && <div className="mt-3 rounded-xl bg-[var(--surface-muted)] p-3 text-[10px]">
          <p className="font-semibold">Automatic variable mapping</p>
          {templateMappings.map(({ number, source }) => <p key={number} className="mt-1 text-[var(--muted)]">{"{{"}{number}{"}}"} ← {source}</p>)}
          {selectedTemplate.buttons.some((button) => button.text === "Visit Website" && button.url === "https://arclivolabs.com/")
            ? <p className="mt-2 text-emerald-700">Visit Website button is linked to https://arclivolabs.com/</p>
            : <p className="mt-2 text-amber-700">This approved template does not contain the specified Visit Website button. Approved template content cannot be altered here; create and approve it first if that CTA is required.</p>}
        </div>}
        <div className="mt-5 flex justify-between">
          <button onClick={() => setStep("upload")} className="text-xs font-semibold text-[var(--muted)]">Back</button>
          <button disabled={busy || !configurationLoaded} onClick={() => void preview()} className="inline-flex items-center gap-2 rounded-xl bg-[#128c50] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
            {busy && <LoaderCircle size={13} className="animate-spin" />} Validate & preview
          </button>
        </div>
      </section>
    </div>}

    {step === "review" && summary && <div className="space-y-4">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["Total Rows", summary.totalRows],
          ["Unique Numbers", summary.uniqueNumbers],
          ["Duplicate Within CSV", summary.duplicateWithinCsv],
          ["Previously Imported / Contacted", summary.previouslyImportedOrContacted],
          ["Invalid Numbers", summary.invalidNumbers],
          ["Missing Template Data", summary.missingTemplateData],
          ["No Consent / Opted Out", summary.noConsentOrOptedOut],
          ["Wrong Category", summary.wrongCategory],
          ["Eligible Recipients", summary.eligibleContacts],
          ["Excluded", summary.excludedContacts]
        ].map(([label, value]) => <div key={String(label)} className="surface rounded-xl p-3">
          <p className="text-[9px] leading-4 text-[var(--muted)]">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p>
        </div>)}
      </section>
      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
          <div><h2 className="text-sm font-semibold">Personalized message preview</h2><p className="mt-1 text-[10px] text-[var(--muted)]">{selectedCategory?.name} · {selectedTemplate?.name} · {summary.eligibleContacts} eligible</p></div>
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((item) => <button key={item.key} onClick={() => setTab(item.key)} className={`rounded-lg px-3 py-2 text-[10px] font-semibold ${tab === item.key ? "bg-[#128c50] text-white" : "bg-[var(--surface-muted)] text-[var(--muted)]"}`}>{item.label}</button>)}
          </div>
        </div>
        <div className="space-y-2 p-3 md:hidden">
          {filteredRows.map((row) => <article key={row.row} className="rounded-xl border border-[var(--border)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-semibold">{row.businessName || "Unnamed business"}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{row.normalizedPhoneNumber || row.phoneNumber || "No phone"} · row {row.row}</p></div>
              <button onClick={() => setFullRow(row)} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[10px]">View</button>
            </div>
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-[var(--surface-muted)] p-2 text-[10px] leading-4">{row.renderedMessage || "Message unavailable"}</p>
            <p className={`mt-2 text-[10px] font-semibold ${row.eligible ? "text-emerald-700" : "text-amber-700"}`}>{row.eligibilityStatus}{row.duplicateType ? ` · ${row.duplicateType}` : ""}</p>
            {row.exclusionReason && <p className="mt-1 text-[10px] text-[var(--muted)]">{row.exclusionReason}{row.duplicateCampaignId ? ` Campaign: ${row.duplicateCampaignId}` : ""}{row.duplicateRecordId ? ` Record: ${row.duplicateRecordId}` : ""}</p>}
          </article>)}
          {!filteredRows.length && <p className="py-8 text-center text-xs text-[var(--muted)]">No rows in this tab.</p>}
        </div>
        <div className="hidden max-h-[560px] overflow-auto md:block">
          <table className="w-full min-w-[850px] text-left text-xs">
            <thead className="sticky top-0 bg-[var(--surface-muted)] text-[10px] uppercase text-[var(--muted)]">
              <tr><th className="px-3 py-2">Business</th><th className="px-3 py-2">WhatsApp</th><th className="px-3 py-2">Personalized message</th><th className="px-3 py-2">Status / reason</th><th className="px-3 py-2">Preview</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredRows.map((row) => <tr key={row.row}>
                <td className="px-3 py-3 font-semibold">{row.businessName || "—"}<span className="block text-[9px] font-normal text-[var(--muted)]">CSV row {row.row}</span></td>
                <td className="px-3 py-3">{row.normalizedPhoneNumber || row.phoneNumber || "—"}</td>
                <td className="max-w-[320px] px-3 py-3"><p className="line-clamp-2 whitespace-pre-wrap">{row.renderedMessage || "—"}</p></td>
                <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${row.eligible ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>{row.eligibilityStatus}</span>
                  {row.duplicateType && <p className="mt-1 text-[9px] text-[var(--muted)]">Duplicate type: {row.duplicateType}</p>}
                  {row.exclusionReason && <p className="mt-1 max-w-[240px] text-[9px] text-[var(--muted)]">{row.exclusionReason}{row.duplicateCampaignId ? ` Campaign: ${row.duplicateCampaignId}` : ""}{row.duplicateRecordId ? ` Record: ${row.duplicateRecordId}` : ""}</p>}
                </td>
                <td className="px-3 py-3"><button onClick={() => setFullRow(row)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-[10px]">View</button></td>
              </tr>)}
              {!filteredRows.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-[var(--muted)]">No rows in this tab.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] p-4">
          <button onClick={downloadErrors} disabled={!previewRows.some((row) => !row.eligible)} className="inline-flex items-center gap-2 text-xs font-semibold disabled:opacity-40"><Download size={13} /> Download duplicate / error CSV</button>
          <div className="flex items-center gap-3">
            <button onClick={() => setStep("configure")} className="text-xs font-semibold text-[var(--muted)]">Back</button>
            <button disabled={!summary.eligibleContacts || busy} onClick={() => setConfirming(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#128c50] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"><Send size={14} /> Start Bulk Messaging</button>
          </div>
        </div>
      </section>
    </div>}

    {fullRow && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="surface w-full max-w-xl rounded-2xl p-5">
        <div className="flex justify-between"><h2 className="text-sm font-semibold">Personalized message preview</h2><button onClick={() => setFullRow(null)}><X size={15} /></button></div>
        <p className="mt-1 text-[10px] text-[var(--muted)]">{fullRow.businessName} · {fullRow.normalizedPhoneNumber || fullRow.phoneNumber}</p>
        <div className="mt-4 rounded-xl bg-[#e8eee9] p-4 text-xs leading-5 text-[#172b19]"><p className="whitespace-pre-wrap">{fullRow.renderedMessage || "No final message"}</p>
        </div>
        <p className="mt-3 text-[10px] text-[var(--muted)]">{fullRow.eligibilityStatus}{fullRow.exclusionReason ? ` · ${fullRow.exclusionReason}` : ""}</p>
      </div>
    </div>}

    {confirming && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="surface w-full max-w-md rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Final confirmation</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Queue {summary?.eligibleContacts ?? 0} eligible recipients in the selected {selectedCategory?.name} category? Contacts, consent, template approval, suppression, and duplicate reservations are checked again before send.</p>
        <p className="mt-2 text-[10px] text-[var(--muted)]">Template: {selectedTemplate?.name}. Once Meta accepts a message, it cannot be recalled.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">Back</button>
          <button disabled={busy} onClick={() => void startCampaign()} className="inline-flex items-center gap-2 rounded-lg bg-[#128c50] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />} Confirm & Start</button>
        </div>
      </div>
    </div>}
  </div>;
}
