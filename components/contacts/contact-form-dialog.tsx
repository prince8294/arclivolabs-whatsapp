"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, LoaderCircle, X } from "lucide-react";
import type { CategoryOption, ContactRecord } from "@/components/contacts/types";
import { getApiError, getContactCategoryId } from "@/components/contacts/types";

type Props = {
  categories: CategoryOption[];
  contact: ContactRecord | null;
  onClose: () => void;
  onSaved: (contact: ContactRecord) => void;
};

export function ContactFormDialog({ categories, contact, onClose, onSaved }: Props) {
  const [businessName, setBusinessName] = useState(contact?.businessName ?? "");
  const [contactPerson, setContactPerson] = useState(contact?.contactPerson ?? "");
  const [phoneNumber, setPhoneNumber] = useState(contact?.phoneNumber ?? "");
  const [categoryId, setCategoryId] = useState(contact ? getContactCategoryId(contact) : "");
  const [city, setCity] = useState(contact?.city ?? "");
  const [state, setState] = useState(contact?.state ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        businessName,
        contactPerson,
        phoneNumber,
        categoryId,
        city,
        state,
        email,
        notes
      };
      const response = await fetch(contact ? `/api/contacts/${contact._id}` : "/api/contacts", {
        method: contact ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const result = (await response.json()) as { contact: ContactRecord };
      onSaved(result.contact);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save contact.");
    } finally {
      setSaving(false);
    }
  }

  function inputClass() {
    return "h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none transition focus:border-[var(--accent)]";
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/45 p-3 sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="contact-form-title" className="surface soft-shadow my-auto max-h-[95vh] w-full max-w-[620px] overflow-y-auto rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="contact-form-title" className="text-base font-semibold">{contact ? "Edit contact" : "Add contact"}</h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Keep business contact details accurate and organized.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close dialog" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)]">
            <X size={17} />
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-medium">Business name <span className="text-red-500">*</span></span>
              <input required maxLength={160} value={businessName} onChange={(event) => setBusinessName(event.target.value)} className={inputClass()} placeholder="Business or organization name" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium">WhatsApp number <span className="text-red-500">*</span></span>
              <input required type="tel" maxLength={32} value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} className={inputClass()} placeholder="+91 98765 43210" />
              <span className="mt-1 block text-[10px] text-[var(--muted)]">International numbers are saved in E.164 format.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium">Business category <span className="text-red-500">*</span></span>
              <select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={inputClass()}>
                <option value="">Select a category</option>
                {categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium">Contact person <span className="text-[var(--muted)]">(optional)</span></span>
              <input maxLength={120} value={contactPerson} onChange={(event) => setContactPerson(event.target.value)} className={inputClass()} placeholder="Full name" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium">Email <span className="text-[var(--muted)]">(optional)</span></span>
              <input type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass()} placeholder="name@example.com" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium">City</span>
              <input maxLength={100} value={city} onChange={(event) => setCity(event.target.value)} className={inputClass()} placeholder="City" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium">State</span>
              <input maxLength={100} value={state} onChange={(event) => setState(event.target.value)} className={inputClass()} placeholder="State" />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-medium">Notes</span>
              <textarea rows={2} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-xs outline-none transition focus:border-[var(--accent)]" placeholder="Optional notes about this contact" />
            </label>
          </div>

          {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-[11px] leading-4 text-red-600 dark:text-red-400"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}</p>}
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-xl border border-[var(--border)] px-3.5 text-xs font-medium hover:bg-[var(--surface-muted)]">Cancel</button>
            <button type="submit" disabled={saving || categories.length === 0} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white hover:bg-[#0f7944] disabled:cursor-not-allowed disabled:opacity-50">
              {saving && <LoaderCircle size={14} className="animate-spin" />}{contact ? "Save changes" : "Save Contact"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
