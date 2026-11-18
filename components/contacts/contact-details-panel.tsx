"use client";

import { CalendarDays, Mail, MapPin, Pencil, Phone, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import type { ContactRecord } from "@/components/contacts/types";
import { getContactCategoryName } from "@/components/contacts/types";

type Props = {
  contact: ContactRecord;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onConsent: () => void;
};

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

export function ContactDetailsPanel({ contact, onClose, onEdit, onDelete, onConsent }: Props) {
  const details = [
    { label: "Contact person", value: contact.contactPerson || "Not provided", icon: UserRound },
    { label: "WhatsApp number", value: contact.phoneNumber, icon: Phone },
    { label: "Category", value: getContactCategoryName(contact), icon: ShieldCheck },
    { label: "Location", value: [contact.city, contact.state].filter(Boolean).join(", ") || "Not provided", icon: MapPin },
    { label: "Email", value: contact.email || "Not provided", icon: Mail }
  ];

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/40" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside role="dialog" aria-modal="true" aria-labelledby="contact-detail-title" className="surface flex h-full w-full max-w-[460px] flex-col overflow-y-auto shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-5 sm:p-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Contact details</p>
            <h2 id="contact-detail-title" className="mt-1 truncate text-lg font-semibold tracking-[-0.03em]">{contact.businessName}</h2>
          </div>
          <button onClick={onClose} aria-label="Close details" className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)]">
            <X size={17} />
          </button>
        </div>
        <div className="flex gap-2 border-b border-[var(--border)] p-4">
          <button onClick={onEdit} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] text-xs font-semibold hover:bg-[var(--surface-muted)]">
            <Pencil size={14} /> Edit
          </button>
          <button onClick={onConsent} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)] hover:opacity-80">
            <ShieldCheck size={14} /> Manage consent
          </button>
          <button onClick={onDelete} aria-label="Delete contact" className="flex h-9 w-10 items-center justify-center rounded-xl border border-red-500/20 text-red-600 hover:bg-red-500/10 dark:text-red-400">
            <Trash2 size={15} />
          </button>
        </div>
        <div className="flex-1 space-y-6 p-5 sm:p-6">
          <section className="space-y-4">
            {details.map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex gap-3">
                <Icon size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                <div className="min-w-0">
                  <p className="text-[10px] text-[var(--muted)]">{label}</p>
                  <p className="mt-0.5 break-words text-xs font-medium">{value}</p>
                </div>
              </div>
            ))}
          </section>

          <section className="border-t border-[var(--border)] pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Marketing consent</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold">{contact.marketingConsentStatus}</span>
              <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${
                contact.marketingConsentStatus === "Opted In"
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : contact.marketingConsentStatus === "Opted Out"
                    ? "bg-red-500/10 text-red-600 dark:text-red-400"
                    : "bg-[var(--surface-muted)] text-[var(--muted)]"
              }`}>
                {contact.marketingConsentStatus === "Opted In" ? "Permission recorded" : contact.marketingConsentStatus === "Opted Out" ? "Do not message" : "Not confirmed"}
              </span>
            </div>
            <div className="mt-3 space-y-2 text-[11px]">
              <p><span className="text-[var(--muted)]">Source:</span> {contact.consentSource || "Not recorded"}</p>
              <p><span className="text-[var(--muted)]">Date:</span> {formatDate(contact.consentTimestamp)}</p>
            </div>
            {!!contact.consentHistory?.length && (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <p className="mb-2 text-[10px] font-medium text-[var(--muted)]">Consent history</p>
                <div className="space-y-2.5">
                  {contact.consentHistory.slice().reverse().map((entry, index) => (
                    <div key={`${entry.timestamp}-${index}`} className="flex items-start gap-2">
                      <CalendarDays size={13} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                      <p className="text-[10px] leading-4">
                        <span className="font-semibold">{entry.status}</span> · {entry.source} · {formatDate(entry.timestamp)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {contact.notes && (
            <section className="border-t border-[var(--border)] pt-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Notes</p>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5">{contact.notes}</p>
            </section>
          )}

          <section className="border-t border-[var(--border)] pt-4">
            <p className="text-[10px] text-[var(--muted)]">Created {formatDate(contact.createdAt)}</p>
          </section>
        </div>
      </aside>
    </div>
  );
}
