"use client";

import { Mail, MapPin, Pencil, Phone, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import type { ContactRecord } from "@/components/contacts/types";
import { getContactCategoryName } from "@/components/contacts/types";

type Props = {
  contact: ContactRecord;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

export function ContactDetailsPanel({ contact, onClose, onEdit, onDelete }: Props) {
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

          {!!contact.campaignNames?.length && <section className="border-t border-[var(--border)] pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">Campaigns</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {contact.campaignNames.map((campaignName) => <span key={campaignName} className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent)]">{campaignName}</span>)}
            </div>
          </section>}

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
