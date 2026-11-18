"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Download, Eye, FileSpreadsheet, LoaderCircle, Send, Upload, X } from "lucide-react";

type CsvSource = Record<string, string>;
type Field = "businessName" | "phoneNumber" | "category" | "city" | "message" | "templateName" | "templateVariable1" | "templateVariable2" | "templateVariable3" | "consentStatus" | "consentSource" | "consentDate";
type Mode = "personalized_csv" | "approved_template";
type NormalizedRow = { row: number; businessName: string; phoneNumber: string; category: string; city: string; message: string; templateName: string; templateVariables: string[]; consentStatus: string; consentSource: string; consentDate: string };
type PreviewRow = NormalizedRow & { normalizedPhoneNumber: string; categoryName: string; effectiveConsentStatus: string; renderedMessage: string; eligibilityStatus: string; exclusionReason: string; eligible: boolean };
type Summary = { totalRows: number; validContacts: number; personalizedMessages: number; duplicateContacts: number; invalidRows: number; contactsWithoutRequiredConsent: number; eligibleContacts: number; excludedContacts: number };
type Template = { _id: string; name: string; language: string; body: string; header: string; footer: string; variables: number[] };

const fields: { key: Field; label: string; required?: boolean }[] = [
  { key: "businessName", label: "Business Name", required: true },
  { key: "phoneNumber", label: "WhatsApp Number", required: true },
  { key: "category", label: "Category", required: true },
  { key: "city", label: "City" },
  { key: "message", label: "Message" },
  { key: "templateName", label: "Template Name" },
  { key: "templateVariable1", label: "Template Variable 1" },
  { key: "templateVariable2", label: "Template Variable 2" },
  { key: "templateVariable3", label: "Template Variable 3" },
  { key: "consentStatus", label: "Consent Status" },
  { key: "consentSource", label: "Consent Source" },
  { key: "consentDate", label: "Consent Date" }
];
const aliases: Record<Field, string[]> = {
  businessName: ["businessname", "business", "company", "organization"], phoneNumber: ["whatsappnumber", "phonenumber", "phone", "mobile"],
  category: ["category", "businesscategory", "industry"], city: ["city", "town"], message: ["message", "personalizedmessage", "custommessage"],
  templateName: ["templatename", "template"], templateVariable1: ["templatevariable1", "variable1", "var1"], templateVariable2: ["templatevariable2", "variable2", "var2"], templateVariable3: ["templatevariable3", "variable3", "var3"],
  consentStatus: ["consentstatus", "marketingconsent", "consent"], consentSource: ["consentsource", "permissionsource"], consentDate: ["consentdate", "consenttimestamp", "permissiondate"]
};
const inputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs outline-none focus:border-[#128c50]";
const sampleCsv = [
  "Business Name,WhatsApp Number,Category,City,Message,Template Name,Template Variable 1,Template Variable 2,Template Variable 3,Consent Status,Consent Source,Consent Date",
  "ABC School,+919876543210,Schools & Education,Patna,\"Hello ABC School, would you like to promote your admissions with influencers?\",,,,Opted In,Website form,2026-10-15",
  "Royal Cafe,+919876543211,Restaurant,Patna,\"Hello Royal Cafe, are you interested in food influencer collaborations?\",,,,Unknown,,"
].join("\r\n");

function key(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function download(name: string, content: string) { const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }

export function PersonalizedCsvWizard() {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "map" | "review">("upload");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sourceRows, setSourceRows] = useState<CsvSource[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<Field, string>>>({});
  const [mode, setMode] = useState<Mode | "">("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [consentFilter, setConsentFilter] = useState("");
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  const [editRow, setEditRow] = useState<number | null>(null);
  const [fullRow, setFullRow] = useState<PreviewRow | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const normalizedRows = useMemo<NormalizedRow[]>(() => sourceRows.map((source, index) => {
    const get = (field: Field) => mapping[field] ? source[mapping[field]!] ?? "" : "";
    return { row: index + 2, businessName: get("businessName").trim(), phoneNumber: get("phoneNumber").trim(), category: get("category").trim(), city: get("city").trim(), message: get("message"), templateName: get("templateName").trim(), templateVariables: [get("templateVariable1"), get("templateVariable2"), get("templateVariable3")], consentStatus: get("consentStatus").trim(), consentSource: get("consentSource").trim(), consentDate: get("consentDate").trim() };
  }), [sourceRows, mapping]);
  const categories = useMemo(() => [...new Set(previewRows.map((row) => row.categoryName).filter(Boolean))].sort(), [previewRows]);
  const cities = useMemo(() => [...new Set(previewRows.map((row) => row.city).filter(Boolean))].sort(), [previewRows]);
  const filteredRows = previewRows.filter((row) => (!categoryFilter || row.categoryName === categoryFilter) && (!cityFilter || row.city === cityFilter) && (!consentFilter || row.effectiveConsentStatus === consentFilter));
  const selectedEligible = filteredRows.filter((row) => row.eligible && !excludedRows.has(row.row));
  const selectedTemplate = templates.find((item) => item._id === templateId);

  async function parseFile(file: File) {
    setNotice("");
    if (!file.name.toLowerCase().endsWith(".csv")) { setNotice("Choose a CSV file."); return; }
    if (file.size > 4 * 1024 * 1024) { setNotice("CSV files must be 4 MB or smaller."); return; }
    setBusy(true);
    try {
      const parsed = await new Promise<Papa.ParseResult<CsvSource>>((resolve, reject) => Papa.parse<CsvSource>(file, { header: true, skipEmptyLines: "greedy", transformHeader: (value) => value.trim(), complete: resolve, error: reject }));
      const foundHeaders = parsed.meta.fields ?? [];
      if (!foundHeaders.length || !parsed.data.length) throw new Error("The CSV has no header or data rows.");
      if (parsed.data.length > 5000) throw new Error("CSV files may contain at most 5,000 rows.");
      const detected: Partial<Record<Field, string>> = {};
      for (const field of fields) { const header = foundHeaders.find((value) => aliases[field.key].includes(key(value))); if (header) detected[field.key] = header; }
      setFileName(file.name); setHeaders(foundHeaders); setSourceRows(parsed.data); setMapping(detected); setStep("map");
      if (parsed.errors.length) setNotice(`The CSV parser reported ${parsed.errors.length} formatting issue(s). Review every row before sending.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The CSV could not be read."); } finally { setBusy(false); }
  }
  function chooseFile(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) void parseFile(file); event.target.value = ""; }
  function changeMapping(field: Field, header: string) { setMapping((current) => { const next = { ...current }; for (const existing of fields) if (existing.key !== field && next[existing.key] === header) delete next[existing.key]; if (header) next[field] = header; else delete next[field]; return next; }); }

  async function loadTemplates() {
    if (templates.length) return;
    const response = await fetch("/api/campaigns/templates", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Approved templates could not be loaded.");
    setTemplates(result.templates as Template[]);
  }
  async function chooseMode(next: Mode) { setMode(next); setTemplateId(""); if (next === "approved_template") { setBusy(true); try { await loadTemplates(); } catch (error) { setNotice(error instanceof Error ? error.message : "Approved templates could not be loaded."); } finally { setBusy(false); } } }

  async function preview(rows = normalizedRows) {
    if (!name.trim()) { setNotice("Enter a campaign name."); return; }
    if (!mapping.businessName || !mapping.phoneNumber || !mapping.category) { setNotice("Map Business Name, WhatsApp Number, and Category."); return; }
    if (!mode) { setNotice("Explicitly choose a sending mode."); return; }
    if (mode === "personalized_csv" && !mapping.message) { setNotice("Map the Message column for personalized CSV mode."); return; }
    if (mode === "approved_template" && !templateId) { setNotice("Choose a Meta-approved template."); return; }
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/campaigns/personalized/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, templateId, rows }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Preview could not be prepared.");
      setPreviewRows(result.rows as PreviewRow[]); setSummary(result.summary as Summary); setExcludedRows(new Set()); setStep("review");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Preview could not be prepared."); } finally { setBusy(false); }
  }
  function updateImportedRow(rowNumber: number, field: "message" | "variable", value: string, variableIndex = 0) {
    const index = rowNumber - 2;
    const mappingField = field === "message" ? "message" : `templateVariable${variableIndex + 1}` as Field;
    const existingHeader = mapping[mappingField];
    const header = existingHeader ?? `__${mappingField}`;
    if (!existingHeader) setMapping((current) => ({ ...current, [mappingField]: header }));
    setSourceRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      return { ...row, [header]: value };
    }));
  }
  async function recheck() { await preview(normalizedRows); setEditRow(null); }
  function downloadErrors() { const rows = previewRows.filter((row) => !row.eligible).map((row) => ({ Row: row.row, "Business Name": row.businessName, "WhatsApp Number": row.phoneNumber, Status: row.eligibilityStatus, Reason: row.exclusionReason })); download("arclivolabs-personalized-campaign-errors.csv", Papa.unparse(rows)); }

  async function startCampaign() {
    setBusy(true); setNotice("");
    try {
      const selectedRows = filteredRows.map((row) => row.row);
      const response = await fetch("/api/campaigns/personalized", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, mode, templateId, rows: normalizedRows, selectedRows, excludedRows: [...excludedRows], confirm: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Campaign import could not be saved.");
      const startResponse = await fetch(`/api/campaigns/${result.campaignId}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      const startResult = await startResponse.json();
      if (!startResponse.ok) throw new Error(`${startResult.error?.message ?? "Campaign could not be queued."} The reviewed campaign remains saved as a draft.`);
      router.push(`/dashboard/bulk-messaging/${result.campaignId}`);
    } catch (error) { setConfirming(false); setNotice(error instanceof Error ? error.message : "Campaign could not be started."); } finally { setBusy(false); }
  }

  return <div className="space-y-5">
    <header><Link href="/dashboard/bulk-messaging" className="mb-3 inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><ArrowLeft size={14} /> Campaign history</Link><h1 className="text-[24px] font-semibold tracking-[-0.04em]">Personalized CSV Campaign</h1><p className="mt-1 text-xs text-[var(--muted)]">Upload unique messages or approved-template variables, verify each recipient, then explicitly confirm sending.</p></header>
    {notice && <div role="alert" className="flex justify-between rounded-xl border border-[var(--border)] px-4 py-3 text-xs"><span>{notice}</span><button onClick={() => setNotice("")}><X size={14} /></button></div>}
    <div className="flex gap-2 text-[10px] font-semibold">{[["upload","Upload CSV"],["map","Map & mode"],["review","Preview & send"]].map(([value,label], index) => <div key={value} className={`rounded-full px-3 py-1.5 ${step === value ? "bg-[#128c50] text-white" : "bg-[var(--surface-muted)] text-[var(--muted)]"}`}>{index + 1}. {label}</div>)}</div>

    {step === "upload" && <section className="surface soft-shadow max-w-2xl rounded-2xl p-5 sm:p-7"><div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-10 text-center"><FileSpreadsheet className="mx-auto text-[var(--accent)]" /><h2 className="mt-3 text-sm font-semibold">Upload personalized recipient CSV</h2><p className="mt-1 text-[11px] text-[var(--muted)]">Up to 4 MB / 5,000 rows. Nothing is saved or sent before review and confirmation.</p><label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#128c50] px-4 py-2.5 text-xs font-semibold text-white"><Upload size={14} /> Choose CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={chooseFile} /></label></div><button onClick={() => download("arclivolabs-personalized-campaign-sample.csv", sampleCsv)} className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)]"><Download size={14} /> Download sample CSV</button></section>}

    {step === "map" && <div className="grid gap-5 xl:grid-cols-[1fr_1fr]"><section className="surface soft-shadow rounded-2xl p-5"><h2 className="text-sm font-semibold">Campaign and column mapping</h2><p className="mt-1 text-[10px] text-[var(--muted)]">{fileName} · {sourceRows.length} rows · detected mappings can be changed.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-semibold">Campaign name<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={`mt-1 ${inputClass}`} /></label><label className="text-[11px] font-semibold">Description<input value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} className={`mt-1 ${inputClass}`} /></label>{fields.map((field) => <label key={field.key} className="text-[11px] font-semibold">{field.label}{field.required && " *"}<select value={mapping[field.key] ?? ""} onChange={(e) => changeMapping(field.key, e.target.value)} className={`mt-1 ${inputClass}`}><option value="">Not mapped</option>{headers.map((header) => <option key={header}>{header}</option>)}</select></label>)}</div></section><section className="surface soft-shadow rounded-2xl p-5"><h2 className="text-sm font-semibold">Explicit sending mode</h2><div className="mt-3 space-y-3"><button onClick={() => void chooseMode("personalized_csv")} className={`w-full rounded-xl border p-4 text-left ${mode === "personalized_csv" ? "border-[#128c50] bg-[var(--accent-soft)]" : "border-[var(--border)]"}`}><span className="text-xs font-semibold">Mode A — Exact personalized CSV text</span><span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">Allowed only inside each recipient’s active 24-hour customer service window. Closed windows are marked Template Required; text is never converted.</span></button><button onClick={() => void chooseMode("approved_template")} className={`w-full rounded-xl border p-4 text-left ${mode === "approved_template" ? "border-[#128c50] bg-[var(--accent-soft)]" : "border-[var(--border)]"}`}><span className="text-xs font-semibold">Mode B — Meta-approved template</span><span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">CSV values fill approved {"{{1}}"}, {"{{2}}"}, and {"{{3}}"} positions without changing the template structure.</span></button></div>{mode === "approved_template" && <label className="mt-4 block text-[11px] font-semibold">Approved template<select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`mt-1 ${inputClass}`}><option value="">Select approved template</option>{templates.map((template) => <option value={template._id} key={template._id}>{template.name} · {template.language}</option>)}</select></label>}{selectedTemplate && <div className="mt-3 rounded-xl bg-[#e8eee9] p-3 text-xs text-[#172b19]"><p className="mb-1 text-[9px] font-semibold uppercase">Approved structure</p>{selectedTemplate.header && <strong className="block">{selectedTemplate.header}</strong>}<p className="mt-1 whitespace-pre-wrap">{selectedTemplate.body}</p>{selectedTemplate.footer && <p className="mt-2 text-[10px]">{selectedTemplate.footer}</p>}</div>}<p className="mt-4 rounded-xl bg-[var(--surface-muted)] p-3 text-[10px] leading-4 text-[var(--muted)]">CSV upload never establishes marketing consent. Existing opt-outs and suppression records always take precedence.</p><div className="mt-5 flex justify-between"><button onClick={() => setStep("upload")} className="text-xs font-semibold text-[var(--muted)]">Back</button><button disabled={busy} onClick={() => void preview()} className="inline-flex items-center gap-2 rounded-xl bg-[#128c50] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{busy && <LoaderCircle size={13} className="animate-spin" />} Validate & preview</button></div></section></div>}

    {step === "review" && summary && <><section className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{[["Total Rows",summary.totalRows],["Valid Contacts",summary.validContacts],["Personalized Messages",summary.personalizedMessages],["Duplicates",summary.duplicateContacts],["Invalid Rows",summary.invalidRows],["Missing Consent",summary.contactsWithoutRequiredConsent],["Eligible",summary.eligibleContacts]].map(([label,value]) => <div key={String(label)} className="surface rounded-xl p-3"><p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</section><section className="surface soft-shadow overflow-hidden rounded-2xl"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] p-4"><div><h2 className="text-sm font-semibold">Personalized message preview</h2><p className="mt-1 text-[10px] text-[var(--muted)]">{selectedEligible.length} eligible and selected · {filteredRows.length - selectedEligible.length} excluded or manually removed</p></div><div className="flex flex-wrap gap-2"><select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={inputClass}><option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select><select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className={inputClass}><option value="">All cities</option>{cities.map((value) => <option key={value}>{value}</option>)}</select><select value={consentFilter} onChange={(e) => setConsentFilter(e.target.value)} className={inputClass}><option value="">All consent statuses</option><option>Opted In</option><option>Unknown</option><option>Opted Out</option></select></div></div><div className="max-h-[560px] overflow-auto"><table className="w-full min-w-[1200px] text-left text-xs"><thead className="sticky top-0 bg-[var(--surface-muted)] text-[10px] uppercase text-[var(--muted)]"><tr><th className="px-3 py-2">Select</th><th className="px-3 py-2">Business</th><th className="px-3 py-2">WhatsApp</th><th className="px-3 py-2">Category / City</th><th className="px-3 py-2">Personalized Message</th><th className="px-3 py-2">Mode</th><th className="px-3 py-2">Eligibility</th><th className="px-3 py-2">Actions</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{filteredRows.map((row) => <tr key={row.row} className={excludedRows.has(row.row) ? "opacity-50" : ""}><td className="px-3 py-3"><input type="checkbox" disabled={!row.eligible} checked={row.eligible && !excludedRows.has(row.row)} onChange={() => setExcludedRows((current) => { const next = new Set(current); next.has(row.row) ? next.delete(row.row) : next.add(row.row); return next; })} className="accent-[#128c50]" /></td><td className="px-3 py-3 font-semibold">{row.businessName}</td><td className="px-3 py-3">{row.normalizedPhoneNumber || row.phoneNumber}</td><td className="px-3 py-3">{row.categoryName}<span className="block text-[10px] text-[var(--muted)]">{row.city || "—"}</span></td><td className="max-w-[340px] px-3 py-3"><p className="line-clamp-2 whitespace-pre-wrap">{row.renderedMessage || "—"}</p></td><td className="px-3 py-3">{mode === "personalized_csv" ? "CSV text" : "Approved template"}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${row.eligible ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>{row.eligibilityStatus}</span>{row.exclusionReason && <p className="mt-1 max-w-[220px] text-[9px] text-[var(--muted)]">{row.exclusionReason}</p>}</td><td className="px-3 py-3"><div className="flex gap-1"><button title="View full message" onClick={() => setFullRow(row)} className="rounded-lg border border-[var(--border)] p-2"><Eye size={13} /></button><button title="Edit imported draft" onClick={() => setEditRow(row.row)} className="rounded-lg border border-[var(--border)] px-2 text-[9px]">Edit draft</button><button title="Exclude contact" disabled={!row.eligible} onClick={() => setExcludedRows((current) => new Set(current).add(row.row))} className="rounded-lg border border-[var(--border)] px-2 text-[9px]">Exclude</button></div></td></tr>)}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] p-4"><div className="flex gap-3"><button onClick={() => downloadErrors()} disabled={!previewRows.some((row) => !row.eligible)} className="inline-flex items-center gap-2 text-xs font-semibold disabled:opacity-40"><Download size={13} /> Error report</button><button onClick={() => setStep("map")} className="text-xs font-semibold text-[var(--muted)]">Edit mapping/mode</button></div><div className="text-right"><p className="mb-2 text-[10px] text-[var(--muted)]">Estimated cost: unavailable — no reliable configured pricing data.</p><button disabled={!selectedEligible.length || busy} onClick={() => setConfirming(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#128c50] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"><Send size={14} /> Start Campaign</button></div></div></section></>}

    {editRow !== null && (() => { const row = normalizedRows.find((item) => item.row === editRow); if (!row) return null; return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"><div className="surface w-full max-w-xl rounded-2xl p-5"><h2 className="text-sm font-semibold">Edit imported draft · {row.businessName}</h2><p className="mt-1 text-[10px] text-[var(--muted)]">The approved template structure is never edited here. Revalidation runs after saving.</p>{mode === "personalized_csv" ? <textarea rows={7} maxLength={4096} value={row.message} onChange={(e) => updateImportedRow(row.row, "message", e.target.value)} className={`mt-4 ${inputClass}`} /> : <div className="mt-4 space-y-2">{[0,1,2].map((index) => <label key={index} className="block text-[10px] font-semibold">Template variable {index + 1}<input value={row.templateVariables[index] ?? ""} onChange={(e) => updateImportedRow(row.row, "variable", e.target.value, index)} className={`mt-1 ${inputClass}`} /></label>)}</div>}<div className="mt-4 flex justify-end gap-2"><button onClick={() => setEditRow(null)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">Cancel</button><button onClick={() => void recheck()} className="rounded-lg bg-[#128c50] px-3 py-2 text-xs font-semibold text-white">Save & revalidate</button></div></div></div>; })()}
    {fullRow && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"><div className="surface w-full max-w-xl rounded-2xl p-5"><div className="flex justify-between"><h2 className="text-sm font-semibold">Final message preview</h2><button onClick={() => setFullRow(null)}><X size={15} /></button></div><p className="mt-1 text-[10px] text-[var(--muted)]">{fullRow.businessName} · {fullRow.normalizedPhoneNumber || fullRow.phoneNumber}</p><div className="mt-4 rounded-xl bg-[#e8eee9] p-4 text-xs leading-5 text-[#172b19]"><p className="whitespace-pre-wrap">{fullRow.renderedMessage || "No final message"}</p></div><p className="mt-3 text-[10px] text-[var(--muted)]">{fullRow.eligibilityStatus}{fullRow.exclusionReason ? ` · ${fullRow.exclusionReason}` : ""}</p></div></div>}
    {confirming && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"><div className="surface w-full max-w-md rounded-2xl p-5"><h2 className="text-sm font-semibold">Final confirmation</h2><p className="mt-2 text-xs leading-5 text-[var(--muted)]">Save this import and queue {selectedEligible.length} currently eligible messages? Every recipient is rechecked immediately before send. API acceptance is not delivery, and sent messages cannot be recalled.</p><p className="mt-2 text-[10px] text-[var(--muted)]">{mode === "personalized_csv" ? "Exact CSV text will only be sent while the customer service window remains open." : `Template: ${selectedTemplate?.name ?? "approved template"}. Resolved variables will be sent inside its approved structure.`}</p><div className="mt-5 flex justify-end gap-2"><button disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">Back</button><button disabled={busy} onClick={() => void startCampaign()} className="inline-flex items-center gap-2 rounded-lg bg-[#128c50] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />} Confirm & Start</button></div></div></div>}
  </div>;
}
