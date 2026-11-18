import { ArrowRight, type LucideIcon } from "lucide-react";
import Link from "next/link";

type PlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  detail: string;
  icon: LucideIcon;
  actionLabel?: string;
  actionHref?: string;
};

export function PlaceholderPage({
  eyebrow,
  title,
  description,
  detail,
  icon: Icon,
  actionLabel,
  actionHref
}: PlaceholderPageProps) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--accent)]">{eyebrow}</p>
        <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.04em] sm:text-[28px]">{title}</h2>
        <p className="mt-2 text-[13px] text-[var(--muted)]">{description}</p>
      </div>
      <div className="surface soft-shadow flex min-h-[330px] flex-col items-center justify-center rounded-2xl px-6 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <Icon size={25} strokeWidth={1.7} />
        </div>
        <span className="mt-5 rounded-full border border-[var(--border)] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
          Foundation phase
        </span>
        <h3 className="mt-3 text-base font-semibold">{detail}</h3>
        <p className="mt-2 max-w-md text-xs leading-5 text-[var(--muted)]">
          This area is ready for future development. No data or actions are simulated here.
        </p>
        {actionHref && actionLabel && (
          <Link href={actionHref} className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)] hover:underline">
            {actionLabel} <ArrowRight size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}
