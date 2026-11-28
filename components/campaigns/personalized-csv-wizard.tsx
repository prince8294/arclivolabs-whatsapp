"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileSpreadsheet, LoaderCircle, Send, Upload, X } from "lucide-react";
import { templateMatchesCategory, templatesForCategory } from "@/lib/campaigns/template-category";

type CsvSource = Record<string, string>;
type Field = "businessName" | "phoneNumber" | "category" | "recommendedSolution" | "businessBenefit";
type NormalizedRow = {
  row: number;
  businessName: string;
  phoneNumber: string;
  category: string;
  city: string;
  recommendedSolution: string;
  businessBenefit: string;
  templateVariables: string[];
};
type Template = {
  _id: string;
  name: string;
  businessCategoryId: string;
  businessCategory: string;
  language: string;
  body: string;
  header: string;
  headerFormat: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  footer: string;
  variables: number[];
  buttons: { type: "QUICK_REPLY" | "URL"; text: string; url?: string }[];
};
type Category = { _id: string; name: string };

const fields: { key: Field; label: string; aliases: string[] }[] = [
  { key: "businessName", label: "Business name", aliases: ["businessname", "business", "company", "companyname", "organization", "name"] },
  { key: "phoneNumber", label: "Phone", aliases: ["phone", "phonenumber", "mobile", "mobilenumber", "number", "whatsapp", "whatsappnumber"] },
  { key: "category", label: "Category", aliases: ["category", "businesscategory", "industry"] },
  { key: "recommendedSolution", label: "Recommended solution", aliases: ["recommendedsolution", "solution", "recommendation"] },
  { key: "businessBenefit", label: "Business benefit", aliases: ["businessbenefit", "benefit"] }
];
const inputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs outline-none focus:border-[#128c50]";

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function csvVariableHeader(headers: string[], number: number) {
  const possible = new Set([`templatevariable${number}`, `variable${number}`, `var${number}`, `parameter${number}`]);
  return headers.find((header) => possible.has(normalizedKey(header)));
}

export function PersonalizedCsvWizard() {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "configure">("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sourceRows, setSourceRows] = useState<CsvSource[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<Field, string>>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
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
        if (active) setTemplates(templateResult.templates as Template[]);
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
  const selectedCategory = categories.find((item) => item._id === selectedCategoryId);
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
    const cityHeader = headers.find((header) => normalizedKey(header) === "city");
    return {
      row: index + 2,
      businessName,
      phoneNumber: get("phoneNumber").trim(),
      category: get("category").trim(),
      city: cityHeader ? (source[cityHeader] ?? "").trim() : "",
      recommendedSolution,
      businessBenefit,
      templateVariables
    };
  }), [sourceRows, mapping, headers, selectedTemplate]);

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
      if (!detected.businessName || !detected.phoneNumber) throw new Error("CSV must include business_name and phone columns.");
      setFileName(file.name);
      setHeaders(foundHeaders);
      setSourceRows(parsed.data);
      setMapping(detected);
      setName("");
      setStep("configure");
      if (parsed.errors.length) setNotice(`The CSV parser reported ${parsed.errors.length} formatting issue(s). Valid rows can still be processed.`);
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

  async function startCampaign() {
    if (!sourceRows.length) { setNotice("Upload a CSV file first."); return; }
    if (!mapping.businessName || !mapping.phoneNumber) { setNotice("CSV must include business_name and phone columns."); return; }
    if (!selectedCategoryId) { setNotice("Select one business category for this campaign."); return; }
    if (!templateId) { setNotice("Choose an approved Meta marketing template."); return; }
    setBusy(true);
    setNotice("");
    try {
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
      if (!response.ok) {
        if (result.error?.code === "EXISTING_DRAFT_CAMPAIGN" && typeof result.campaignId === "string") {
          router.push(`/dashboard/bulk-messaging/${result.campaignId}`);
          return;
        }
        throw new Error(result.error?.message ?? "Campaign could not be created.");
      }
      const startResponse = await fetch(`/api/campaigns/${result.campaignId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const startResult = await startResponse.json();
      if (!startResponse.ok) throw new Error(`${startResult.error?.message ?? "Campaign could not be queued."} The campaign and imported contacts were saved.`);
      router.push(`/dashboard/bulk-messaging/${result.campaignId}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaign could not be started.");
    } finally {
      setBusy(false);
    }
  }

  const templateMappings = selectedTemplate?.variables.map((number) => ({
    number,
    source: number === 1 ? "business_name" : number === 2 ? "recommended_solution" : number === 3 ? "business_benefit" : csvVariableHeader(headers, number) ?? `variable_${number}`
  })) ?? [];

  return <div className="space-y-5">
    <header>
      <Link href="/dashboard/bulk-messaging" className="mb-3 inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><ArrowLeft size={14} /> Campaign history</Link>
      <h1 className="text-[24px] font-semibold tracking-[-0.04em]">Bulk Messaging</h1>
      <p className="mt-1 text-xs text-[var(--muted)]">Upload a CSV, choose a category and approved template, then start the campaign.</p>
    </header>
    {notice && <div role="alert" className="flex justify-between rounded-xl border border-[var(--border)] px-4 py-3 text-xs"><span>{notice}</span><button onClick={() => setNotice("")}><X size={14} /></button></div>}
    <div className="flex gap-2 text-[10px] font-semibold">
      {[["upload", "Upload CSV"], ["configure", "Campaign setup"]].map(([value, label], index) =>
        <div key={value} className={`rounded-full px-3 py-1.5 ${step === value ? "bg-[#128c50] text-white" : "bg-[var(--surface-muted)] text-[var(--muted)]"}`}>{index + 1}. {label}</div>
      )}
    </div>

    {step === "upload" && <section className="surface soft-shadow max-w-2xl rounded-2xl p-5 sm:p-7">
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-8 text-center sm:p-10">
        <FileSpreadsheet className="mx-auto text-[var(--accent)]" />
        <h2 className="mt-3 text-sm font-semibold">Upload recipient CSV</h2>
        <p className="mt-1 text-[11px] text-[var(--muted)]">Up to 4 MB and 5,000 rows. Uploaded contacts are automatically saved in Contacts.</p>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#128c50] px-4 py-2.5 text-xs font-semibold text-white">
          <Upload size={14} /> Choose CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={chooseFile} />
        </label>
      </div>
      <p className="mt-4 text-[10px] leading-4 text-[var(--muted)]">Required headers: <code>business_name</code> and <code>phone</code>. Optional: <code>category</code>, <code>city</code>, <code>recommended_solution</code>, <code>business_benefit</code>, and extra template variables.</p>
    </section>}

    {step === "configure" && <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <section className="surface soft-shadow rounded-2xl p-5">
        <h2 className="text-sm font-semibold">CSV details</h2>
        <p className="mt-1 text-[10px] text-[var(--muted)]">{fileName} · {sourceRows.length} rows · contacts will be added or updated automatically.</p>
        <div className="mt-4 space-y-2">
          {fields.map((field) => <div key={field.key} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-[11px]">
            <span className="font-medium">{field.label}</span>
            <span className="max-w-[55%] truncate text-right text-[var(--muted)]">{mapping[field.key] ?? (field.key === "category" ? "Selected category" : "Not found")}</span>
          </div>)}
        </div>
        <label className="mt-4 block text-[11px] font-semibold">Campaign name
          <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={`${selectedCategory?.name ?? "Bulk"} campaign`} className={`mt-1 ${inputClass}`} />
        </label>
      </section>
      <section className="surface soft-shadow rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Category and template</h2>
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
        {configurationLoaded && selectedCategoryId && templates.length > 0 && !availableTemplates.length && <p className="mt-3 text-[10px] text-amber-700">No approved Marketing template is assigned to {selectedCategory?.name ?? "this category"}. Assign the category from Templates first.</p>}
        {selectedTemplate && <div className="mt-4 rounded-xl bg-[var(--surface-muted)] p-3 text-[10px]">
          <p className="font-semibold">Automatic variable mapping</p>
          {templateMappings.map(({ number, source }) => <p key={number} className="mt-1 text-[var(--muted)]">{"{{"}{number}{"}}"} ← {source}</p>)}
        </div>}
        <div className="mt-5 flex justify-between">
          <button disabled={busy} onClick={() => setStep("upload")} className="text-xs font-semibold text-[var(--muted)]">Back</button>
          <button disabled={busy || !configurationLoaded || !selectedCategoryId || !templateId} onClick={() => void startCampaign()} className="inline-flex items-center gap-2 rounded-xl bg-[#128c50] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Send size={14} />} {busy ? "Starting…" : "Start Campaign"}
          </button>
        </div>
      </section>
    </div>}
  </div>;
}
