"use client";

import Papa from "papaparse";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Upload,
  X
} from "lucide-react";
import type { CategoryOption } from "@/components/contacts/types";
import { getApiError } from "@/components/contacts/types";
import type { ContactConsentStatus } from "@/components/contacts/types";

type Props = {
  categories: CategoryOption[];
  onClose: () => void;
  onImported: (message: string) => void;
};

type ImportField =
  | "businessName"
  | "phoneNumber"
  | "categoryName"
  | "contactPerson"
  | "city"
  | "state"
  | "email"
  | "notes"
  | "marketingConsentStatus"
  | "consentSource"
  | "consentTimestamp";

type CsvRow = Record<string, string>;
type PreviewRow = { row: number; businessName: string; phoneNumber: string; status: string; errors: string[] };
type ImportSummary = { totalRows: number; validContacts: number; duplicateContacts: number; invalidContacts: number; excludedRows: number; readyContacts: number };
type ImportResult = { successfullyImported: number; duplicatesSkipped: number; failedRecords: number; updatedContacts: number; excludedRows: number; rows: PreviewRow[] };

const fieldOptions: { key: ImportField; label: string; required?: boolean }[] = [
  { key: "businessName", label: "Business name", required: true },
  { key: "phoneNumber", label: "WhatsApp number", required: true },
  { key: "categoryName", label: "Category" },
  { key: "contactPerson", label: "Contact person" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "email", label: "Email" },
  { key: "notes", label: "Notes" },
  { key: "marketingConsentStatus", label: "Consent status" },
  { key: "consentSource", label: "Consent source" },
  { key: "consentTimestamp", label: "Consent date" }
];

const aliases: Record<ImportField, string[]> = {
  businessName: ["businessname", "business", "company", "organization", "name"],
  phoneNumber: ["whatsappnumber", "phonenumber", "phone", "mobile", "number"],
  categoryName: ["category", "businesscategory", "industry"],
  contactPerson: ["contactperson", "person", "contactname"],
  city: ["city", "town"],
  state: ["state", "province"],
  email: ["email", "emailaddress"],
  notes: ["notes", "note", "comments"],
  marketingConsentStatus: ["consentstatus", "marketingconsent", "consent"],
  consentSource: ["consentsource", "permissionsource"],
  consentTimestamp: ["consentdate", "consenttimestamp", "permissiondate"]
};

const fileLimit = 1.5 * 1024 * 1024;
const sampleCsv = [
  "Business Name,WhatsApp Number,Category,City,State,Email,Contact Person,Notes,Consent Status,Consent Source,Consent Date",
  "Sample School,+919876543210,Schools,Patna,Bihar,school@example.com,Example Contact,Sample data only,Unknown,,",
  "Example Cafe,+919876543211,Restaurant,Delhi,Delhi,cafe@example.com,Example Contact,Sample data only,Unknown,,",
  "Fictional Hotel,+919876543212,Hotel,Mumbai,Maharashtra,hotel@example.com,Example Contact,Sample data only,Unknown,,"
].join("\r\n");

function normalizeHeader(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeCategory(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function findCategoryMatch(value: string, categories: CategoryOption[]) {
  const query = normalizeCategory(value);
  if (!query) return "";
  const matches = categories.filter((category) => {
    const name = normalizeCategory(category.name);
    return name === query || name.includes(query) || query.includes(name);
  });
  return matches.length === 1 ? matches[0]._id : "";
}

function normalizeConsent(value: string): ContactConsentStatus | string {
  const normalized = value.toLocaleLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "optedin") return "Opted In";
  if (normalized === "optedout") return "Opted Out";
  if (normalized === "unknown" || !normalized) return "Unknown";
  return value;
}

function downloadText(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportWizard({ categories, onClose, onImported }: Props) {
  const [step, setStep] = useState<"upload" | "mapping" | "review" | "results">("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [categoryMapping, setCategoryMapping] = useState<Record<string, string>>({});
  const [blankCategoryChoice, setBlankCategoryChoice] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rawCategories = useMemo(() => {
    const header = mapping.categoryName;
    if (!header) return [];
    return Array.from(new Set(csvRows.map((row) => row[header]?.trim() ?? "").filter(Boolean)));
  }, [csvRows, mapping.categoryName]);
  const rowsWithoutCategory = useMemo(() => {
    const header = mapping.categoryName;
    return csvRows.some((row) => !header || !row[header]?.trim());
  }, [csvRows, mapping.categoryName]);
  const requiredFieldsMapped = Boolean(mapping.businessName && mapping.phoneNumber);
  const missingRequired = fieldOptions.filter((field) => field.required && !mapping[field.key]);
  const unresolvedCategories = rawCategories.filter((value) => !categoryMapping[value]);
  const canContinue =
    requiredFieldsMapped &&
    unresolvedCategories.length === 0 &&
    (!rowsWithoutCategory || Boolean(blankCategoryChoice));

  useEffect(() => {
    if (categories.length === 1 && !defaultCategoryId) setDefaultCategoryId(categories[0]._id);
  }, [categories, defaultCategoryId]);

  useEffect(() => {
    setCategoryMapping((current) => {
      const next = { ...current };
      for (const value of rawCategories) {
        if (!next[value]) next[value] = findCategoryMatch(value, categories);
      }
      return next;
    });
  }, [categories, rawCategories]);

  const mappedRows = useMemo(() => {
    return csvRows.map((source) => {
      const get = (field: ImportField) => {
        const header = mapping[field];
        return header ? (source[header] ?? "").trim() : "";
      };
      const rawCategory = get("categoryName");
      const choice = rawCategory ? categoryMapping[rawCategory] ?? "" : blankCategoryChoice;
      if (choice === "exclude") {
        return { businessName: get("businessName"), excluded: true };
      }
      const categoryId = choice && choice !== "exclude" ? choice : defaultCategoryId;
      const consentSource = get("consentSource");
      const consentTimestamp = get("consentTimestamp");
      return {
        businessName: get("businessName"),
        phoneNumber: get("phoneNumber"),
        categoryId,
        contactPerson: get("contactPerson"),
        city: get("city"),
        state: get("state"),
        email: get("email"),
        notes: get("notes"),
        marketingConsentStatus: normalizeConsent(get("marketingConsentStatus")),
        consentSource,
        consentTimestamp,
        permissionDocumented: Boolean(consentSource && consentTimestamp)
      };
    });
  }, [csvRows, mapping, categoryMapping, blankCategoryChoice, defaultCategoryId]);

  async function parseFile(file: File) {
    setError("");
    if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
      setError("Choose a CSV file.");
      return;
    }
    if (file.size > fileLimit) {
      setError("CSV files must be 1.5 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const parsed = await new Promise<Papa.ParseResult<CsvRow>>((resolve, reject) => {
        Papa.parse<CsvRow>(file, {
          header: true,
          skipEmptyLines: "greedy",
          transformHeader: (header: string) => header.trim(),
          complete: resolve,
          error: reject
        });
      });
      const foundHeaders: string[] = parsed.meta.fields ?? [];
      if (!foundHeaders.length || !parsed.data.length) throw new Error("The CSV is empty or has no header row.");
      if (parsed.data.length > 5000) throw new Error("CSV files may contain at most 5,000 data rows.");
      const nextMapping: Partial<Record<ImportField, string>> = {};
      for (const field of fieldOptions) {
        const match = foundHeaders.find((header) => aliases[field.key].includes(normalizeHeader(header)));
        if (match) nextMapping[field.key] = match;
      }
      setFileName(file.name);
      setHeaders(foundHeaders);
      setCsvRows(parsed.data);
      setMapping(nextMapping);
      setCategoryMapping({});
      setBlankCategoryChoice("");
      setDefaultCategoryId(categories.length === 1 ? categories[0]._id : "");
      setStep("mapping");
      if (parsed.errors.length) setError(`CSV parser found ${parsed.errors.length} formatting issue(s); review the preview before continuing.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read the CSV file.");
    } finally {
      setBusy(false);
    }
  }

  function changeFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void parseFile(file);
    event.target.value = "";
  }

  function setFieldMapping(field: ImportField, header: string) {
    setMapping((current) => {
      const next = { ...current };
      if (!header) delete next[field];
      else {
        for (const key of Object.keys(next) as ImportField[]) {
          if (key !== field && next[key] === header) delete next[key];
        }
        next[field] = header;
      }
      return next;
    });
  }

  async function requestPreview(mode: "preview" | "commit", nextUpdateExisting = updateExisting) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, updateExisting: nextUpdateExisting, rows: mappedRows })
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const data = await response.json();
      if (mode === "preview") {
        setSummary(data.summary as ImportSummary);
        setPreviewRows(data.rows as PreviewRow[]);
        setUpdateExisting(nextUpdateExisting);
        setStep("review");
      } else {
        setResult(data.result as ImportResult);
        setStep("results");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import request failed.");
    } finally {
      setBusy(false);
    }
  }

  function downloadErrorReport() {
    if (!result) return;
    const lines = [["Row", "Business Name", "WhatsApp Number", "Status", "Errors"]];
    for (const row of result.rows.filter((entry) => ["invalid", "failed", "duplicate"].includes(entry.status))) {
      lines.push([String(row.row), row.businessName, row.phoneNumber, row.status, row.errors.join("; ")]);
    }
    const csv = Papa.unparse(lines);
    downloadText("arclivolabs-contact-import-errors.csv", csv, "text/csv;charset=utf-8");
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/50 p-2 sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="import-title" className="surface soft-shadow my-auto flex max-h-[96vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Contact import</p>
            <h2 id="import-title" className="mt-1 text-base font-semibold">Import contacts from CSV</h2>
            <p className="mt-1 text-[10px] text-[var(--muted)]">{fileName || "Upload, map, review and confirm before importing."}</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close import dialog" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)]"><X size={17} /></button>
        </div>

        <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-3 sm:px-6">
          {(["upload", "mapping", "review", "results"] as const).map((item, index) => {
            const active = step === item;
            const passed = ["upload", "mapping", "review", "results"].indexOf(step) > index;
            return (
              <div key={item} className="flex min-w-0 flex-1 items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${active ? "bg-[#128c50] text-white" : passed ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-muted)] text-[var(--muted)]"}`}>
                  {passed ? <Check size={12} /> : index + 1}
                </span>
                <span className={`hidden truncate text-[10px] font-medium sm:block ${active ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>{item === "upload" ? "Upload" : item === "mapping" ? "Map columns" : item === "review" ? "Review" : "Results"}</span>
                {index < 3 && <span className="h-px flex-1 bg-[var(--border)]" />}
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {step === "upload" && (
            <div className="mx-auto max-w-xl">
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-5 py-10 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><Upload size={21} /></span>
                <h3 className="mt-4 text-sm font-semibold">Choose a CSV file</h3>
                <p className="mt-1 text-[11px] text-[var(--muted)]">Up to 1.5 MB and 5,000 contact rows. Your data is not imported until you confirm.</p>
                <label className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white hover:bg-[#0f7944]">
                  {busy ? <LoaderCircle size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Browse CSV
                  <input type="file" accept=".csv,text/csv" className="sr-only" onChange={changeFile} disabled={busy} />
                </label>
              </div>
              <button onClick={() => downloadText("arclivolabs-contact-sample.csv", sampleCsv, "text/csv;charset=utf-8")} className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--accent)] hover:underline">
                <Download size={14} /> Download sample CSV
              </button>
              <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Sample rows are fictional examples only. New contacts default to Unknown consent.</p>
            </div>
          )}

          {step === "mapping" && (
            <div className="space-y-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-sm font-semibold">Map CSV columns</h3>
                  <p className="mt-1 text-[10px] text-[var(--muted)]">Match each uploaded header to a contact field. Nothing is imported yet.</p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-[10px] font-medium text-[var(--accent)]">
                  <Upload size={13} /> Replace file
                  <input type="file" accept=".csv,text/csv" className="sr-only" onChange={changeFile} disabled={busy} />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {fieldOptions.map((field) => (
                  <label key={field.key} className="block rounded-xl border border-[var(--border)] p-3">
                    <span className="mb-1.5 block text-[10px] font-medium">{field.label} {field.required && <span className="text-red-500">*</span>}</span>
                    <select value={mapping[field.key] ?? ""} onChange={(event) => setFieldMapping(field.key, event.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 text-[10px] outline-none focus:border-[var(--accent)]">
                      <option value="">Not mapped</option>
                      {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {missingRequired.length > 0 && (
                <p role="alert" className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-[10px] text-amber-800 dark:text-amber-300">
                  Map the required column{missingRequired.length === 1 ? "" : "s"}: {missingRequired.map((field) => field.label).join(", ")}.
                </p>
              )}

              {(rawCategories.length > 0 || rowsWithoutCategory) && (
                <section className="rounded-xl border border-[var(--border)] p-4">
                  <h3 className="text-[11px] font-semibold">Match categories</h3>
                  <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Only unique, clear matches are selected automatically. Choose a saved category or exclude those rows.</p>
                  <div className="mt-3 space-y-2.5">
                    {rawCategories.map((name) => {
                      const choice = categoryMapping[name] ?? "";
                      return (
                        <label key={name} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                          <span className="truncate text-[10px]">{name}</span>
                          <select value={choice} onChange={(event) => setCategoryMapping((current) => ({ ...current, [name]: event.target.value }))} className="h-8 min-w-[210px] rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-[10px] outline-none focus:border-[var(--accent)]">
                            <option value="">Select category…</option>
                            {categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}
                            <option value="exclude">Exclude these rows</option>
                          </select>
                        </label>
                      );
                    })}
                    {rowsWithoutCategory && (
                      <label className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-[10px]">Rows without a category</span>
                        <select value={blankCategoryChoice} onChange={(event) => setBlankCategoryChoice(event.target.value)} className="h-8 min-w-[210px] rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-[10px] outline-none focus:border-[var(--accent)]">
                          <option value="">Select a category…</option>
                          {categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}
                          <option value="exclude">Exclude these rows</option>
                        </select>
                      </label>
                    )}
                  </div>
                </section>
              )}

              <section className="overflow-hidden rounded-xl border border-[var(--border)]">
                <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-[10px] font-semibold">Preview · first 10 rows</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[9px]">
                    <thead><tr className="text-[var(--muted)]">{headers.slice(0, 6).map((header) => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}</tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">{csvRows.slice(0, 10).map((row, index) => <tr key={index}>{headers.slice(0, 6).map((header) => <td key={header} className="max-w-[180px] truncate px-3 py-2">{row[header] || "—"}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {step === "review" && summary && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold">Review import</h3>
                <p className="mt-1 text-[10px] text-[var(--muted)]">Review validations and duplicate handling before writing any records.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ["Total rows", summary.totalRows],
                  ["Valid", summary.validContacts],
                  ["Duplicates", summary.duplicateContacts],
                  ["Invalid", summary.invalidContacts],
                  ["Ready", summary.readyContacts]
                ].map(([label, count]) => (
                  <div key={String(label)} className="rounded-xl border border-[var(--border)] p-3">
                    <p className="text-[9px] text-[var(--muted)]">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{count}</p>
                  </div>
                ))}
              </div>
              <label className="flex items-start gap-2 rounded-xl border border-[var(--border)] p-3 text-[10px] leading-4">
                <input type="checkbox" checked={updateExisting} disabled={busy} onChange={(event) => void requestPreview("preview", event.target.checked)} className="mt-0.5 accent-[#128c50]" />
                <span><span className="font-semibold">Update existing contacts</span><br /><span className="text-[var(--muted)]">Matching numbers update profile details. Existing opt-outs are preserved, and consent history is appended rather than replaced.</span></span>
              </label>
              {previewRows.some((row) => row.status === "invalid" || row.status === "duplicate") && (
                <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                  <p className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-[10px] font-semibold">Rows to review</p>
                  <div className="max-h-44 overflow-y-auto">
                    {previewRows.filter((row) => row.status === "invalid" || row.status === "duplicate").slice(0, 40).map((row) => (
                      <div key={row.row} className="flex flex-col gap-1 border-b border-[var(--border)] px-3 py-2 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-[10px]">{row.row}. {row.businessName || row.phoneNumber || "Unnamed row"}</span>
                        <span className={`text-[9px] ${row.status === "invalid" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"}`}>{row.errors.join("; ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-[10px] leading-4 text-[var(--muted)]">
                Consent remains Unknown unless opted-in source and date are supplied. Existing opt-outs and consent history are preserved.
              </p>
            </div>
          )}

          {step === "results" && result && (
            <div className="mx-auto max-w-xl py-3 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><Check size={22} /></span>
              <h3 className="mt-4 text-base font-semibold">Import finished</h3>
              <p className="mt-1 text-[11px] text-[var(--muted)]">The batch was processed. No WhatsApp messages were sent.</p>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Imported", result.successfullyImported],
                  ["Duplicates skipped", result.duplicatesSkipped],
                  ["Failed", result.failedRecords],
                  ["Updated", result.updatedContacts]
                ].map(([label, count]) => (
                  <div key={String(label)} className="rounded-xl border border-[var(--border)] p-3">
                    <p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-1 text-lg font-semibold">{count}</p>
                  </div>
                ))}
              </div>
              {result.rows.some((row) => row.status === "invalid" || row.status === "failed" || row.status === "duplicate") && (
                <button onClick={downloadErrorReport} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border)] px-3.5 text-xs font-semibold hover:bg-[var(--surface-muted)]">
                  <Download size={14} /> Download error report
                </button>
              )}
            </div>
          )}

          {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-[10px] leading-4 text-red-600 dark:text-red-400"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3.5 sm:px-6">
          <div>
            {step === "mapping" && <button onClick={() => setStep("upload")} disabled={busy} className="inline-flex h-9 items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={14} /> Back</button>}
            {step === "review" && <button onClick={() => setStep("mapping")} disabled={busy} className="inline-flex h-9 items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={14} /> Edit mapping</button>}
          </div>
          <div className="flex gap-2">
            {step !== "results" && <button onClick={onClose} disabled={busy} className="h-9 rounded-xl border border-[var(--border)] px-3.5 text-xs font-medium hover:bg-[var(--surface-muted)]">Cancel</button>}
            {step === "mapping" && (
              <button disabled={!canContinue || busy} onClick={() => void requestPreview("preview")} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white hover:bg-[#0f7944] disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? <LoaderCircle size={14} className="animate-spin" /> : null} Review contacts <ArrowRight size={14} />
              </button>
            )}
            {step === "review" && (
              <button disabled={busy || !summary || summary.readyContacts === 0} onClick={() => void requestPreview("commit")} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white hover:bg-[#0f7944] disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? <LoaderCircle size={14} className="animate-spin" /> : null} Import Contacts
              </button>
            )}
            {step === "results" && <button onClick={() => onImported(`${result?.successfullyImported ?? 0} contacts imported.`)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white hover:bg-[#0f7944]">Done <Check size={14} /></button>}
          </div>
        </div>
      </section>
    </div>
  );
}
