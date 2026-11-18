"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  X
} from "lucide-react";
import { categoryIconOptions, categoryIcons, type CategoryIconName } from "@/lib/categories/icons";

type Category = {
  _id: string;
  name: string;
  slug: string;
  description: string;
  icon: CategoryIconName;
  contactCount: number;
};

type CategoryForm = { name: string; description: string; icon: CategoryIconName };
type DialogState = { type: "form"; category: Category | null } | { type: "delete"; category: Category };

const emptyForm: CategoryForm = { name: "", description: "", icon: "building" };

async function responseError(response: Response) {
  const result = await response.json().catch(() => null);
  return result?.error?.message ?? "The request could not be completed.";
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/categories", { cache: "no-store" });
      if (response.status === 401) {
        setUnauthorized(true);
        setCategories([]);
        return;
      }
      if (!response.ok) throw new Error(await responseError(response));
      const result = (await response.json()) as { categories: Category[] };
      setCategories(result.categories);
      setUnauthorized(false);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load categories.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return categories.filter((category) => category.name.toLocaleLowerCase().includes(query));
  }, [categories, search]);

  function openCreate() {
    setForm(emptyForm);
    setDialog({ type: "form", category: null });
  }

  function openEdit(category: Category) {
    setForm({ name: category.name, description: category.description ?? "", icon: category.icon });
    setDialog({ type: "form", category });
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) return;

    setSaving(true);
    try {
      const editing = dialog?.type === "form" ? dialog.category : null;
      const response = await fetch(editing ? `/api/categories/${editing._id}` : "/api/categories", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (response.status === 401) {
        setUnauthorized(true);
        setDialog(null);
        throw new Error("Your admin session has expired. Sign in again to continue.");
      }
      if (!response.ok) throw new Error(await responseError(response));
      const result = (await response.json()) as { category: Category };
      setCategories((items) => {
        const next = editing
          ? items.map((item) => (item._id === editing._id ? result.category : item))
          : [...items, result.category];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      setDialog(null);
      setNotice({ type: "success", message: editing ? "Category updated." : "Category created." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Could not save category." });
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(category: Category) {
    setSaving(true);
    try {
      const response = await fetch(`/api/categories/${category._id}`, { method: "DELETE" });
      if (response.status === 401) {
        setUnauthorized(true);
        setDialog(null);
        throw new Error("Your admin session has expired. Sign in again to continue.");
      }
      if (!response.ok) throw new Error(await responseError(response));
      setCategories((items) => items.filter((item) => item._id !== category._id));
      setDialog(null);
      setNotice({ type: "success", message: "Category deleted." });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Could not delete category." });
      if (category.contactCount > 0) setDialog(null);
      else if (error instanceof Error && error.message.toLocaleLowerCase().includes("contact")) {
        setDialog(null);
        await loadCategories();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--accent)]">Contact organization</p>
          <h2 className="mt-2 text-[23px] font-semibold tracking-[-0.04em] sm:text-[27px]">Business Categories</h2>
          <p className="mt-1.5 text-[13px] text-[var(--muted)]">Organize your business contacts by category.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={unauthorized}
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-[#128c50] px-4 text-xs font-semibold text-white transition hover:bg-[#0f7944] disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          <Plus size={15} /> Add Category
        </button>
      </section>

      {unauthorized ? (
        <section className="surface soft-shadow rounded-2xl px-6 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <AlertCircle size={21} />
          </div>
          <h3 className="mt-4 text-sm font-semibold">Admin sign-in required</h3>
          <p className="mt-1.5 text-xs text-[var(--muted)]">Sign in to view and manage business categories.</p>
          <Link href="/login" className="mt-4 inline-flex h-9 items-center rounded-xl bg-[#128c50] px-4 text-xs font-semibold text-white hover:bg-[#0f7944]">
            Sign in
          </Link>
        </section>
      ) : (
        <>
          <section className="surface soft-shadow flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <label className="relative block w-full sm:max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search categories"
                aria-label="Search categories by name"
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] pl-9 pr-3 text-xs outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
              />
            </label>
            <p className="text-xs text-[var(--muted)]">
              <span className="font-semibold text-[var(--foreground)]">{loading || loadError ? "—" : categories.length}</span>{" "}
              {categories.length === 1 ? "category" : "categories"}
            </p>
          </section>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="surface animate-pulse rounded-2xl p-5">
                  <div className="mb-5 h-10 w-10 rounded-xl bg-[var(--surface-muted)]" />
                  <div className="mb-3 h-4 w-36 rounded bg-[var(--surface-muted)]" />
                  <div className="h-3 w-24 rounded bg-[var(--surface-muted)]" />
                  <div className="mt-6 h-8 rounded bg-[var(--surface-muted)]" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <section role="alert" className="surface soft-shadow rounded-2xl px-6 py-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400">
                <AlertCircle size={21} />
              </div>
              <h3 className="mt-4 text-sm font-semibold">Categories could not be loaded</h3>
              <p className="mt-1.5 text-xs text-[var(--muted)]">{loadError}</p>
              <button onClick={() => void loadCategories()} className="mt-4 h-9 rounded-xl border border-[var(--border)] px-3.5 text-xs font-semibold hover:bg-[var(--surface-muted)]">
                Try again
              </button>
            </section>
          ) : filteredCategories.length === 0 ? (
            <section className="surface soft-shadow rounded-2xl px-6 py-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--muted)]">
                {search ? <Search size={21} /> : <Building2 size={21} />}
              </div>
              <h3 className="mt-4 text-sm font-semibold">{search ? "No matching categories" : "No categories yet"}</h3>
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                {search ? "Try another search term." : "Create your first category to start organizing your contacts."}
              </p>
              {!search && (
                <button onClick={openCreate} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#128c50] px-3 text-xs font-semibold text-white hover:bg-[#0f7944]">
                  <Plus size={14} /> Add Category
                </button>
              )}
            </section>
          ) : (
            <section aria-label="Business categories" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredCategories.map((category) => {
                const Icon = categoryIcons[category.icon] ?? Building2;
                return (
                  <article key={category._id} className="surface soft-shadow rounded-2xl p-4 transition hover:-translate-y-0.5 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                        <Icon size={19} strokeWidth={1.8} />
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Edit ${category.name}`}
                          onClick={() => openEdit(category)}
                          className="rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${category.name}`}
                          onClick={() => setDialog({ type: "delete", category })}
                          className="rounded-lg p-2 text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <h3 className="mt-4 truncate text-sm font-semibold">{category.name}</h3>
                    <p className="mt-1 min-h-8 text-[11px] leading-4 text-[var(--muted)]">
                      {category.description || "No description"}
                    </p>
                    <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3">
                      <span className="text-[10px] text-[var(--muted)]">Contacts</span>
                      <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-semibold">
                        {category.contactCount}
                      </span>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}

      {notice && (
        <div
          role="status"
          className={`fixed bottom-5 right-4 z-[70] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border px-4 py-3 text-xs shadow-lg sm:right-6 ${
            notice.type === "success"
              ? "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
              : "border-red-500/20 bg-[var(--surface)] text-red-600 dark:text-red-400"
          }`}
        >
          {notice.type === "success" ? <Check size={15} className="text-[var(--accent)]" /> : <AlertCircle size={15} />}
          {notice.message}
          <button onClick={() => setNotice(null)} aria-label="Dismiss notification" className="ml-1 rounded p-0.5 opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {dialog?.type === "form" && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setDialog(null);
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="category-dialog-title" className="surface soft-shadow my-auto w-full max-w-[440px] rounded-2xl p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="category-dialog-title" className="text-base font-semibold">
                  {dialog.category ? "Edit category" : "Add category"}
                </h3>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  {dialog.category ? "Update the category details." : "Create a category for your business contacts."}
                </p>
              </div>
              <button onClick={() => setDialog(null)} disabled={saving} aria-label="Close dialog" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)]">
                <X size={17} />
              </button>
            </div>
            <form onSubmit={saveCategory} className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium">Category name <span className="text-red-500">*</span></span>
                <input
                  autoFocus
                  required
                  minLength={1}
                  maxLength={80}
                  value={form.name}
                  onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                  placeholder="e.g. Schools & Education"
                  className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none transition focus:border-[var(--accent)]"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium">Description <span className="text-[var(--muted)]">(optional)</span></span>
                <textarea
                  maxLength={280}
                  rows={3}
                  value={form.description}
                  onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))}
                  placeholder="A short note about this category"
                  className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-xs outline-none transition focus:border-[var(--accent)]"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium">Category icon</span>
                <select
                  value={form.icon}
                  onChange={(event) => setForm((value) => ({ ...value, icon: event.target.value as CategoryIconName }))}
                  className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none transition focus:border-[var(--accent)]"
                >
                  {categoryIconOptions.map((option) => (
                    <option key={option.name} value={option.name}>{option.label}</option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
                <button type="button" disabled={saving} onClick={() => setDialog(null)} className="h-9 rounded-xl border border-[var(--border)] px-3.5 text-xs font-medium hover:bg-[var(--surface-muted)] disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving || !form.name.trim()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white hover:bg-[#0f7944] disabled:cursor-not-allowed disabled:opacity-60">
                  {saving && <LoaderCircle size={14} className="animate-spin" />}
                  {dialog.category ? "Save changes" : "Save Category"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {dialog?.type === "delete" && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" className="surface soft-shadow w-full max-w-[400px] rounded-2xl p-5 sm:p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
              <Trash2 size={18} />
            </div>
            <h3 id="delete-dialog-title" className="mt-4 text-base font-semibold">Delete category?</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              You&apos;re about to delete <span className="font-semibold text-[var(--foreground)]">{dialog.category.name}</span>. Contacts will never be deleted automatically.
            </p>
            {dialog.category.contactCount > 0 && (
              <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[11px] leading-5 text-amber-800 dark:text-amber-300">
                This category contains {dialog.category.contactCount} contact{dialog.category.contactCount === 1 ? "" : "s"}. Reassign or uncategorize them before deleting this category.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button disabled={saving} onClick={() => setDialog(null)} className="h-9 rounded-xl border border-[var(--border)] px-3.5 text-xs font-medium hover:bg-[var(--surface-muted)]">
                Cancel
              </button>
              <button
                disabled={saving || dialog.category.contactCount > 0}
                onClick={() => void deleteCategory(dialog.category)}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-600 px-3.5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving && <LoaderCircle size={14} className="animate-spin" />}
                Delete category
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
