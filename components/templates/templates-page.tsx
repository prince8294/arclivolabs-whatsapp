"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Clock3, Eye, FileText, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";

type Template = {
  _id: string;
  name: string;
  businessCategoryId: string;
  businessCategory: string;
  language: string;
  metaCategory: string;
  metaStatus: string;
  isDraft: boolean;
  body: string;
  rejectionReason: string;
  createdAt: string;
  updatedAt: string;
};

const statusClass: Record<string, string> = {
  DRAFT: "bg-[var(--surface-muted)] text-[var(--muted)]",
  APPROVED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  PENDING: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  IN_REVIEW: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  REJECTED: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  PAUSED: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  DISABLED: "bg-[var(--surface-muted)] text-[var(--muted)]"
};

function displayStatus(template: Template) {
  if (template.isDraft) return "Draft";
  if (!template.metaStatus) return "Status unavailable";
  return template.metaStatus.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizedStatus(template: Template) {
  return template.isDraft ? "DRAFT" : template.metaStatus.toUpperCase() || "UNKNOWN";
}

export function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [viewing, setViewing] = useState<Template | null>(null);
  const pageSize = 10;

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/templates", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Templates could not be loaded.");
      setTemplates(result.templates as Template[]);
      setState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Templates could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => ({
    total: templates.length,
    approved: templates.filter((item) => !item.isDraft && item.metaStatus.toUpperCase() === "APPROVED").length,
    pending: templates.filter((item) => ["PENDING", "IN_REVIEW"].includes(item.metaStatus.toUpperCase())).length,
    rejected: templates.filter((item) => item.metaStatus.toUpperCase() === "REJECTED").length
  }), [templates]);
  const categories = useMemo(() => [...new Set(templates.map((item) => item.businessCategory).filter(Boolean))].sort(), [templates]);
  const filtered = useMemo(() => templates.filter((item) => {
    const textMatch = `${item.name} ${item.businessCategory} ${item.body}`.toLowerCase().includes(search.toLowerCase());
    const categoryMatch = !category || item.businessCategory === category;
    const statusMatch = !status || normalizedStatus(item) === status;
    return textMatch && categoryMatch && statusMatch;
  }), [templates, search, category, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageTemplates = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [search, category, status]);

  async function synchronize(action: "sync" | "refresh") {
    setBusy(action);
    setNotice("");
    try {
      const response = await fetch("/api/templates/sync", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Template synchronization failed.");
      await load();
      setNotice(action === "sync"
        ? `Templates synchronized with Meta. ${result.imported} imported, ${result.updated} updated.`
        : "Template statuses refreshed from Meta.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Template synchronization failed.");
    } finally {
      setBusy("");
    }
  }

  async function removeTemplate(template: Template) {
    const submitted = !template.isDraft || Boolean(template.metaStatus);
    const note = submitted
      ? "This removes only the local CRM record. It will not delete the template from Meta. Continue?"
      : "This removes the draft from the CRM. Continue?";
    if (!window.confirm(note)) return;
    const deleteFromMeta = submitted && window.confirm(
      `Also permanently delete “${template.name}” from Meta? This affects the WhatsApp Business Account, not just this CRM.`
    );
    setBusy(template._id);
    try {
      const response = await fetch(`/api/templates/${template._id}${deleteFromMeta ? "?deleteFromMeta=true" : ""}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Template could not be deleted.");
      setTemplates((items) => items.filter((item) => item._id !== template._id));
      setNotice(deleteFromMeta ? "Template deleted from Meta and removed from the local CRM." : "Template removed from the local CRM.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Template could not be deleted.");
    } finally {
      setBusy("");
    }
  }

  const metrics = [
    { label: "Total Templates", value: stats.total, icon: FileText, tone: "text-[var(--accent)] bg-[var(--accent-soft)]" },
    { label: "Approved Templates", value: stats.approved, icon: Check, tone: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300" },
    { label: "Pending Approval", value: stats.pending, icon: Clock3, tone: "text-amber-700 bg-amber-500/10 dark:text-amber-300" },
    { label: "Rejected Templates", value: stats.rejected, icon: CircleAlert, tone: "text-rose-700 bg-rose-500/10 dark:text-rose-300" }
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Message library</p>
          <h1 className="text-[24px] font-semibold tracking-[-0.04em] sm:text-[28px]">Message Templates</h1>
          <p className="mt-1.5 text-[13px] text-[var(--muted)]">Create and manage WhatsApp messages for different business categories.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void synchronize("sync")} disabled={Boolean(busy)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-xs font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50">
            <RefreshCw size={14} className={busy === "sync" ? "animate-spin" : ""} /> Sync Templates
          </button>
          <Link href="/dashboard/templates/create" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#128c50] px-4 text-xs font-semibold text-white transition hover:bg-[#0f7944]">
            <Plus size={15} /> Create Template
          </Link>
        </div>
      </header>

      {notice && <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={15} /></button></div>}

      <section aria-label="Template statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className="surface soft-shadow rounded-2xl p-4">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}><Icon size={16} /></div>
            <p className="mt-4 text-[11px] text-[var(--muted)]">{label}</p>
            <p className="mt-1 text-[25px] font-semibold leading-none tracking-[-0.04em]">{value}</p>
          </article>
        ))}
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input aria-label="Search templates" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates..." className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs outline-none focus:border-[var(--accent)]" />
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Filter by business category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-9 min-w-[150px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none">
              <option value="">All business categories</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select aria-label="Filter by template status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 min-w-[140px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none">
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option><option value="PENDING">Pending</option><option value="IN_REVIEW">In review</option>
              <option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="PAUSED">Paused</option><option value="DISABLED">Disabled</option>
            </select>
            <button type="button" onClick={() => void synchronize("refresh")} disabled={Boolean(busy)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-medium hover:bg-[var(--surface-muted)] disabled:opacity-50">
              <RefreshCw size={13} className={busy === "refresh" ? "animate-spin" : ""} /> Refresh Status
            </button>
          </div>
        </div>
        {state === "loading" ? (
          <div className="space-y-3 p-5" aria-label="Loading templates">{[0, 1, 2, 3].map((item) => <div key={item} className="h-12 animate-pulse rounded-lg bg-[var(--surface-muted)]" />)}</div>
        ) : state === "error" ? (
          <div className="py-12 text-center"><p className="text-sm font-medium">Templates could not be loaded</p><button type="button" onClick={() => void load()} className="mt-2 text-xs font-semibold text-[var(--accent)]">Try again</button></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-14 text-center">
            <FileText size={22} className="text-[var(--muted)]" />
            <p className="mt-3 text-sm font-semibold">{templates.length ? "No templates match your filters" : "No templates yet"}</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--muted)]">{templates.length ? "Try a different search or filter." : "Create a draft or synchronize templates from your connected WhatsApp Business Account."}</p>
            {!templates.length && <Link href="/dashboard/templates/create" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#128c50] px-3 py-2 text-xs font-semibold text-white"><Plus size={14} /> Create Template</Link>}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[790px] text-left">
                <thead><tr className="bg-[var(--surface-muted)] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--muted)]">
                  <th className="px-5 py-3">Template Name</th><th className="px-4 py-3">Business Category</th><th className="px-4 py-3">Language</th><th className="px-4 py-3">Meta Status</th><th className="px-4 py-3">Last Updated</th><th className="px-5 py-3 text-right">Actions</th>
                </tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {pageTemplates.map((template) => {
                    const normalized = normalizedStatus(template);
                    return <tr key={template._id} className="text-xs">
                      <td className="px-5 py-3.5"><p className="font-semibold">{template.name}</p><p className="mt-1 max-w-[220px] truncate text-[10px] text-[var(--muted)]">{template.body}</p></td>
                      <td className="px-4 py-3.5">{template.businessCategory || <span className="text-[var(--muted)]">—</span>}</td>
                      <td className="px-4 py-3.5 uppercase">{template.language}</td>
                      <td className="px-4 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusClass[normalized] ?? statusClass.DRAFT}`}>{displayStatus(template)}</span>{normalized === "REJECTED" && template.rejectionReason && <p className="mt-1 max-w-[150px] truncate text-[10px] text-rose-700 dark:text-rose-300" title={template.rejectionReason}>{template.rejectionReason}</p>}</td>
                      <td className="px-4 py-3.5 text-[var(--muted)]">{new Date(template.updatedAt).toLocaleDateString()}</td>
                      <td className="px-5 py-3.5"><div className="flex justify-end gap-1">
                        <button aria-label={`View ${template.name}`} title="View" onClick={() => setViewing(template)} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"><Eye size={14} /></button>
                        {template.isDraft
                          ? <Link aria-label={`Edit ${template.name}`} title="Edit draft" href={`/dashboard/templates/${template._id}/edit`} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"><Pencil size={14} /></Link>
                          : normalized === "APPROVED"
                            ? <Link aria-label={`Edit category for ${template.name}`} title="Edit business category only" href={`/dashboard/templates/${template._id}/edit`} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"><Pencil size={14} /></Link>
                            : <button aria-label={`Edit ${template.name} unavailable`} title="Only approved Meta templates allow category editing." disabled className="rounded-lg p-2 text-[var(--muted)] opacity-40"><Pencil size={14} /></button>}
                        {!template.isDraft && <button aria-label={`Refresh ${template.name}`} title="Check Status" onClick={() => void synchronize("refresh")} disabled={Boolean(busy)} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)]"><RefreshCw size={14} /></button>}
                        <button aria-label={`Delete ${template.name}`} title="Delete local record" disabled={busy === template._id} onClick={() => void removeTemplate(template)} className="rounded-lg p-2 text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-50"><Trash2 size={14} /></button>
                      </div></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3 text-[11px] text-[var(--muted)]">
              <span>Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span>
              <div className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 disabled:opacity-40">Previous</button><span>Page {page} of {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 disabled:opacity-40">Next</button></div>
            </div>
          </>
        )}
      </section>

      {viewing && <div role="dialog" aria-modal="true" aria-label={`Template ${viewing.name}`} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null); }}>
        <div className="surface w-full max-w-lg rounded-2xl p-5 shadow-xl">
          <div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Template preview</p><h2 className="mt-1 text-lg font-semibold">{viewing.name}</h2></div><button aria-label="Close preview" onClick={() => setViewing(null)} className="rounded-lg p-2 hover:bg-[var(--surface-muted)]"><X size={16} /></button></div>
          <div className="mt-4 rounded-xl bg-[#e6eee8] p-4 dark:bg-[#17251c]"><div className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2.5 text-xs leading-5 text-[#172b19]">{viewing.body}</div></div>
          <div className="mt-3 flex justify-between text-[11px] text-[var(--muted)]"><span>{viewing.businessCategory || "No business category"} · {viewing.language}</span><span>{displayStatus(viewing)}</span></div>
        </div>
      </div>}
      {busy && state !== "loading" && busy !== "sync" && busy !== "refresh" && <span className="sr-only" aria-live="polite"><LoaderCircle className="animate-spin" /></span>}
    </div>
  );
}
