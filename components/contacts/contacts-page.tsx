"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ContactRound,
  FileUp,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";
import { ContactDetailsPanel } from "@/components/contacts/contact-details-panel";
import { ConsentDialog } from "@/components/contacts/consent-dialog";
import { ImportWizard } from "@/components/contacts/import-wizard";
import { getApiError, getContactCategoryName, type CategoryOption, type ContactRecord, type ContactConsentStatus } from "@/components/contacts/types";

type ContactStats = {
  totalContacts: number;
  categoriesWithContacts: number;
  optedIn: number;
  optedOut: number;
};

type DeleteTarget = { type: "single"; contact: ContactRecord } | { type: "bulk"; ids: string[] };

const emptyStats: ContactStats = { totalContacts: 0, categoriesWithContacts: 0, optedIn: 0, optedOut: 0 };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function ContactsPage() {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [stats, setStats] = useState<ContactStats>(emptyStats);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [consentFilter, setConsentFilter] = useState<ContactConsentStatus | "">("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRecord | null>(null);
  const [details, setDetails] = useState<ContactRecord | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [consentContact, setConsentContact] = useState<ContactRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set("search", search.trim());
    if (categoryFilter) params.set("categoryId", categoryFilter);
    if (cityFilter) params.set("city", cityFilter);
    if (consentFilter) params.set("consent", consentFilter);
    return params.toString();
  }, [page, pageSize, search, categoryFilter, cityFilter, consentFilter]);

  const loadContacts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/contacts?${query}`, { cache: "no-store", signal });
      if (response.status === 401) {
        setUnauthorized(true);
        setContacts([]);
        return;
      }
      if (!response.ok) throw new Error(await getApiError(response));
      const result = await response.json() as {
        contacts: ContactRecord[];
        total: number;
        totalPages: number;
        cities: string[];
        stats: ContactStats;
      };
      setContacts(result.contacts);
      setFilteredTotal(result.total);
      setTotalPages(result.totalPages);
      setCities(result.cities);
      setStats(result.stats);
      setUnauthorized(false);
      setSelectedIds([]);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setLoadError(error instanceof Error ? error.message : "Could not load contacts.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    void loadContacts(controller.signal);
    return () => controller.abort();
  }, [loadContacts]);

  useEffect(() => {
    let active = true;
    fetch("/api/categories", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error(await getApiError(response));
        const result = await response.json() as { categories: CategoryOption[] };
        if (active) setCategories(result.categories);
      })
      .catch((error: unknown) => {
        if (active) setNotice({ type: "error", message: error instanceof Error ? error.message : "Could not load categories." });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function openDetails(contact: ContactRecord) {
    setDetailsLoading(true);
    try {
      const response = await fetch(`/api/contacts/${contact._id}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await getApiError(response));
      const result = await response.json() as { contact: ContactRecord };
      setDetails(result.contact);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Could not load contact details." });
    } finally {
      setDetailsLoading(false);
    }
  }

  function startEdit(contact: ContactRecord | null) {
    setDetails(null);
    setEditing(contact);
    setFormOpen(true);
  }

  async function savedContact(contact: ContactRecord) {
    setFormOpen(false);
    setEditing(null);
    setDetails((current) => current?._id === contact._id ? contact : current);
    setNotice({ type: "success", message: editing ? "Contact updated." : "Contact added." });
    await loadContacts();
  }

  async function savedConsent(contact: ContactRecord) {
    setConsentContact(null);
    setDetails(contact);
    setNotice({ type: "success", message: "Marketing consent updated and recorded." });
    await loadContacts();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const isBulk = deleteTarget.type === "bulk";
      const response = isBulk
        ? await fetch("/api/contacts/bulk-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: deleteTarget.ids })
          })
        : await fetch(`/api/contacts/${deleteTarget.contact._id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await getApiError(response));
      const result = isBulk ? await response.json() as { deleted: number } : null;
      setDeleteTarget(null);
      setDetails(null);
      setNotice({ type: "success", message: isBulk ? `${result?.deleted ?? 0} contacts deleted.` : "Contact deleted." });
      await loadContacts();
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Could not delete contact." });
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  const allCurrentSelected = contacts.length > 0 && contacts.every((contact) => selectedIds.includes(contact._id));
  function toggleCurrentPage() {
    setSelectedIds((current) =>
      allCurrentSelected
        ? current.filter((id) => !contacts.some((contact) => contact._id === id))
        : Array.from(new Set([...current, ...contacts.map((contact) => contact._id)]))
    );
  }

  const metricCards = [
    { title: "Total contacts", value: stats.totalContacts, hint: "Saved in your workspace", icon: ContactRound },
    { title: "Categories with contacts", value: stats.categoriesWithContacts, hint: "Categories currently in use", icon: MapPin },
    { title: "Marketing opted-in", value: stats.optedIn, hint: "Documented permission recorded", icon: ShieldCheck },
    { title: "Opted out", value: stats.optedOut, hint: "Do not message", icon: X }
  ];

  if (unauthorized) {
    return (
      <div className="surface soft-shadow mx-auto mt-10 max-w-xl rounded-2xl px-6 py-12 text-center">
        <AlertCircle size={23} className="mx-auto text-[var(--accent)]" />
        <h2 className="mt-4 text-sm font-semibold">Admin sign-in required</h2>
        <p className="mt-1.5 text-xs text-[var(--muted)]">Sign in to view and manage your contacts.</p>
        <Link href="/login" className="mt-4 inline-flex h-9 items-center rounded-xl bg-[#128c50] px-4 text-xs font-semibold text-white hover:bg-[#0f7944]">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--accent)]">Contact directory</p>
          <h2 className="mt-2 text-[23px] font-semibold tracking-[-0.04em] sm:text-[27px]">Contacts</h2>
          <p className="mt-1.5 text-[13px] text-[var(--muted)]">Manage and organize your business contacts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setImportOpen(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-xs font-semibold transition hover:bg-[var(--surface-muted)]">
            <FileUp size={15} /> Import CSV
          </button>
          <button onClick={() => startEdit(null)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white transition hover:bg-[#0f7944]">
            <Plus size={15} /> Add Contact
          </button>
        </div>
      </section>

      <section aria-label="Contact statistics" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {metricCards.map(({ title, value, hint, icon: Icon }) => (
          <article key={title} className="surface soft-shadow rounded-2xl p-4 sm:p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon size={17} /></span>
            <p className="mt-4 text-[11px] font-medium text-[var(--muted)] sm:text-xs">{title}</p>
            {loading ? <div className="mt-2 h-7 w-14 animate-pulse rounded bg-[var(--surface-muted)]" /> : <p className="mt-1 text-[27px] font-semibold leading-none tracking-[-0.05em]">{loadError ? "—" : value}</p>}
            <p className="mt-2 text-[10px] text-[var(--muted)]">{hint}</p>
          </article>
        ))}
      </section>

      <section className="surface soft-shadow overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 lg:flex-row lg:items-center lg:justify-between sm:px-5">
          <label className="relative block w-full lg:max-w-[280px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search business, number, city" aria-label="Search contacts" className="h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] pl-9 pr-3 text-xs outline-none focus:border-[var(--accent)]" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Filter by category" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }} className="h-9 min-w-[145px] rounded-xl border border-[var(--border)] bg-[var(--background)] px-2.5 text-[11px] outline-none focus:border-[var(--accent)]">
              <option value="">All Categories</option>
              {categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}
            </select>
            <select aria-label="Filter by city" value={cityFilter} onChange={(event) => { setCityFilter(event.target.value); setPage(1); }} className="h-9 min-w-[120px] rounded-xl border border-[var(--border)] bg-[var(--background)] px-2.5 text-[11px] outline-none focus:border-[var(--accent)]">
              <option value="">All Cities</option>
              {cities.map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
            <select aria-label="Filter by marketing consent" value={consentFilter} onChange={(event) => { setConsentFilter(event.target.value as ContactConsentStatus | ""); setPage(1); }} className="h-9 min-w-[130px] rounded-xl border border-[var(--border)] bg-[var(--background)] px-2.5 text-[11px] outline-none focus:border-[var(--accent)]">
              <option value="">All Consent</option><option>Opted In</option><option>Unknown</option><option>Opted Out</option>
            </select>
            <select aria-label="Contacts per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="h-9 rounded-xl border border-[var(--border)] bg-[var(--background)] px-2.5 text-[11px] outline-none focus:border-[var(--accent)]">
              <option value={20}>20 / page</option><option value={50}>50 / page</option>
            </select>
          </div>
        </div>

        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
          <p className="text-[11px] text-[var(--muted)]">
            {loading ? "Loading contacts…" : `Showing ${filteredTotal === 0 ? 0 : (page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredTotal)} of ${filteredTotal} filtered contacts`}
          </p>
          {selectedIds.length > 0 && (
            <button onClick={() => setDeleteTarget({ type: "bulk", ids: selectedIds })} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-2.5 text-[10px] font-semibold text-white hover:bg-red-700">
              <Trash2 size={13} /> Delete selected ({selectedIds.length})
            </button>
          )}
        </div>

        {loadError ? (
          <div role="alert" className="px-6 py-12 text-center">
            <AlertCircle size={21} className="mx-auto text-red-500" />
            <p className="mt-3 text-xs font-semibold">Contacts could not be loaded</p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">{loadError}</p>
            <button onClick={() => void loadContacts()} className="mt-3 h-8 rounded-lg border border-[var(--border)] px-3 text-[11px] font-semibold hover:bg-[var(--surface-muted)]">Try again</button>
          </div>
        ) : loading ? (
          <div className="space-y-3 px-4 pb-5 sm:px-5">
            {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-[var(--surface-muted)]" />)}
          </div>
        ) : contacts.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <ContactRound size={23} className="mx-auto text-[var(--muted)]" />
            <h3 className="mt-3 text-sm font-semibold">{stats.totalContacts === 0 ? "No contacts yet" : "No matching contacts"}</h3>
            <p className="mt-1 text-[11px] text-[var(--muted)]">{stats.totalContacts === 0 ? "Add a contact or import a CSV to get started." : "Adjust your search or filters to see contacts."}</p>
            {stats.totalContacts === 0 && (
              <button onClick={() => startEdit(null)} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#128c50] px-3 text-xs font-semibold text-white hover:bg-[#0f7944]"><Plus size={14} /> Add Contact</button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="bg-[var(--surface-muted)] text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  <th className="w-10 px-4 py-3"><input type="checkbox" checked={allCurrentSelected} onChange={toggleCurrentPage} aria-label="Select all contacts on this page" className="accent-[#128c50]" /></th>
                  <th className="px-3 py-3">Business name</th>
                  <th className="px-3 py-3">WhatsApp number</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">City</th>
                  <th className="px-3 py-3">Marketing consent</th>
                  <th className="px-3 py-3">Created date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {contacts.map((contact) => (
                  <tr key={contact._id} className="text-[11px] transition hover:bg-[var(--surface-muted)]/70">
                    <td className="px-4 py-3"><input type="checkbox" checked={selectedIds.includes(contact._id)} onChange={() => toggleSelected(contact._id)} aria-label={`Select ${contact.businessName}`} className="accent-[#128c50]" /></td>
                    <td className="max-w-[200px] px-3 py-3">
                      <button onClick={() => void openDetails(contact)} className="block truncate text-left font-semibold hover:text-[var(--accent)]">{contact.businessName}</button>
                      {contact.contactPerson && <span className="mt-0.5 block truncate text-[9px] text-[var(--muted)]">{contact.contactPerson}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">{contact.phoneNumber}</td>
                    <td className="max-w-[180px] truncate px-3 py-3">{getContactCategoryName(contact)}</td>
                    <td className="px-3 py-3">{contact.city || "—"}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-semibold ${
                        contact.marketingConsentStatus === "Opted In"
                          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                          : contact.marketingConsentStatus === "Opted Out"
                            ? "bg-red-500/10 text-red-600 dark:text-red-400"
                            : "bg-[var(--surface-muted)] text-[var(--muted)]"
                      }`}>{contact.marketingConsentStatus}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[var(--muted)]">{formatDate(contact.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-0.5">
                        <button title="View details" aria-label={`View ${contact.businessName}`} onClick={() => void openDetails(contact)} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"><UserRound size={14} /></button>
                        <button title="Edit contact" aria-label={`Edit ${contact.businessName}`} onClick={() => startEdit(contact)} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"><Pencil size={14} /></button>
                        <button title="Delete contact" aria-label={`Delete ${contact.businessName}`} onClick={() => setDeleteTarget({ type: "single", contact })} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !loadError && totalPages > 0 && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 sm:px-5">
            <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[10px] font-medium disabled:opacity-40"><ArrowLeft size={13} /> Previous</button>
            <span className="text-[10px] text-[var(--muted)]">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[10px] font-medium disabled:opacity-40">Next <ArrowRight size={13} /></button>
          </div>
        )}
      </section>

      {notice && (
        <div role={notice.type === "error" ? "alert" : "status"} className={`fixed bottom-5 right-4 z-[100] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border bg-[var(--surface)] px-4 py-3 text-xs shadow-lg sm:right-6 ${notice.type === "success" ? "border-[var(--border)]" : "border-red-500/30 text-red-600 dark:text-red-400"}`}>
          {notice.type === "success" ? <Check size={15} className="text-[var(--accent)]" /> : <AlertCircle size={15} />}
          {notice.message}
          <button onClick={() => setNotice(null)} aria-label="Dismiss notification" className="ml-1 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {detailsLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25">
          <span className="flex items-center gap-2 rounded-xl bg-[var(--surface)] px-4 py-3 text-xs shadow"><LoaderCircle size={15} className="animate-spin" /> Loading contact…</span>
        </div>
      )}
      {details && (
        <ContactDetailsPanel
          contact={details}
          onClose={() => setDetails(null)}
          onEdit={() => startEdit(details)}
          onDelete={() => setDeleteTarget({ type: "single", contact: details })}
          onConsent={() => setConsentContact(details)}
        />
      )}
      {formOpen && <ContactFormDialog categories={categories} contact={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={(contact) => void savedContact(contact)} />}
      {consentContact && <ConsentDialog contact={consentContact} onClose={() => setConsentContact(null)} onSaved={(contact) => void savedConsent(contact)} />}
      {importOpen && <ImportWizard categories={categories} onClose={() => setImportOpen(false)} onImported={async (message) => { setImportOpen(false); setNotice({ type: "success", message }); await loadContacts(); }} />}

      {deleteTarget && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="contact-delete-title" className="surface soft-shadow w-full max-w-[400px] rounded-2xl p-5 sm:p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400"><Trash2 size={18} /></div>
            <h2 id="contact-delete-title" className="mt-4 text-base font-semibold">Delete {deleteTarget.type === "bulk" ? "selected contacts" : "contact"}?</h2>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              {deleteTarget.type === "bulk"
                ? `This will permanently delete ${deleteTarget.ids.length} selected contact records.`
                : <>This will permanently delete <span className="font-semibold text-[var(--foreground)]">{deleteTarget.contact.businessName}</span>.</>}
              {" "}This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button disabled={deleting} onClick={() => setDeleteTarget(null)} className="h-9 rounded-xl border border-[var(--border)] px-3.5 text-xs font-medium hover:bg-[var(--surface-muted)]">Cancel</button>
              <button disabled={deleting} onClick={() => void confirmDelete()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-600 px-3.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {deleting ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
