"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, LoaderCircle, X } from "lucide-react";
import type { ContactRecord, ContactConsentStatus } from "@/components/contacts/types";
import { getApiError } from "@/components/contacts/types";

type Props = {
  contact: ContactRecord;
  onClose: () => void;
  onSaved: (contact: ContactRecord) => void;
};

function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ConsentDialog({ contact, onClose, onSaved }: Props) {
  const [status, setStatus] = useState<ContactConsentStatus>(contact.marketingConsentStatus);
  const [source, setSource] = useState(contact.consentSource ?? "");
  const [timestamp, setTimestamp] = useState(localDateTime(contact.consentTimestamp));
  const [permissionDocumented, setPermissionDocumented] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/contacts/${contact._id}/consent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketingConsentStatus: status,
          consentSource: source,
          consentTimestamp: timestamp ? new Date(timestamp).toISOString() : "",
          permissionDocumented
        })
      });
      if (!response.ok) throw new Error(await getApiError(response));
      const result = (await response.json()) as { contact: ContactRecord };
      onSaved(result.contact);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update consent.");
    } finally {
      setSaving(false);
    }
  }

  const requiresEvidence = status !== "Unknown";
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="consent-dialog-title" className="surface soft-shadow w-full max-w-[430px] rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 id="consent-dialog-title" className="text-base font-semibold">Manage marketing consent</h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">{contact.businessName}</p>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Close dialog" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)]"><X size={17} /></button>
        </div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium">Consent status</span>
            <select
              value={status}
              onChange={(event) => {
                const next = event.target.value as ContactConsentStatus;
                setStatus(next);
                if (next === "Unknown") {
                  setSource("");
                  setTimestamp("");
                }
              }}
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none focus:border-[var(--accent)]"
            >
              <option>Unknown</option><option>Opted In</option><option>Opted Out</option>
            </select>
          </label>
          {requiresEvidence && (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium">Consent source <span className="text-red-500">*</span></span>
                <input required maxLength={120} value={source} onChange={(event) => setSource(event.target.value)} placeholder="e.g. Signed form or inbound request" className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none focus:border-[var(--accent)]" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium">Consent date <span className="text-red-500">*</span></span>
                <input required type="datetime-local" value={timestamp} onChange={(event) => setTimestamp(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none focus:border-[var(--accent)]" />
              </label>
            </>
          )}
          {status === "Opted In" && contact.marketingConsentStatus !== "Opted In" && (
            <label className="flex items-start gap-2 text-[10px] leading-4 text-[var(--muted)]">
              <input type="checkbox" checked={permissionDocumented} onChange={(event) => setPermissionDocumented(event.target.checked)} className="mt-0.5 accent-[#128c50]" />
              <span>I have verified that documented permission exists.</span>
            </label>
          )}
          {error && <p role="alert" className="flex gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-[11px] text-red-600 dark:text-red-400"><AlertCircle size={14} className="shrink-0" />{error}</p>}
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-xl border border-[var(--border)] px-3.5 text-xs font-medium hover:bg-[var(--surface-muted)]">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white hover:bg-[#0f7944] disabled:opacity-50">
              {saving && <LoaderCircle size={14} className="animate-spin" />} Save consent
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
