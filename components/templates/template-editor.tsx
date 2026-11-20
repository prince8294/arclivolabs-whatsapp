"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Info, Plus, Send, Save, Trash2 } from "lucide-react";

type Category = { _id: string; name: string };
type Button = { type: "QUICK_REPLY" | "URL"; text: string; url?: string };
type VariableMapping = "contactPerson" | "businessName" | "city" | "";
type EditorTemplate = {
  _id?: string;
  name: string;
  businessCategoryId: string;
  metaCategory: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  header: string;
  body: string;
  footer: string;
  buttons: Button[];
  variableSamples: Record<string, string>;
  variableMappings: { number: number; mapping: VariableMapping }[];
};

const blankTemplate: EditorTemplate = {
  name: "",
  businessCategoryId: "",
  metaCategory: "MARKETING",
  language: "en",
  header: "",
  body: "",
  footer: "",
  buttons: [],
  variableSamples: {},
  variableMappings: []
};

const examples = [
  {
    category: "Schools & Education",
    name: "school_promotion",
    body: "Hello {{1}},\n\nWe are ArclivoLabs, an influencer marketing agency.\n\nWe help educational institutions promote their courses, admissions and brand awareness through relevant content creators.\n\nWould you like to explore a promotional campaign?\n\nTeam ArclivoLabs"
  },
  {
    category: "Restaurants & Cafes",
    name: "restaurant_promotion",
    body: "Hello {{1}},\n\nWe are ArclivoLabs.\n\nWe connect restaurants and cafes with relevant food and lifestyle influencers for promotional campaigns.\n\nWould you like to know more about our services?\n\nTeam ArclivoLabs"
  },
  {
    category: "Hotels & Resorts",
    name: "hotel_promotion",
    body: "Hello {{1}},\n\nArclivoLabs helps hotels and resorts collaborate with travel and lifestyle creators to promote their properties.\n\nWould you be interested in exploring a collaboration?\n\nTeam ArclivoLabs"
  },
  {
    category: "Real Estate",
    name: "realestate_promotion",
    body: "Hello {{1}},\n\nWe are ArclivoLabs, an influencer marketing agency.\n\nWe help real estate businesses promote their properties and projects through relevant creators and digital campaigns.\n\nWould you like to discuss a promotional campaign?\n\nTeam ArclivoLabs"
  }
];

type TemplateEditorProps = { templateId?: string };

export function TemplateEditor({ templateId }: TemplateEditorProps) {
  const [template, setTemplate] = useState<EditorTemplate>(blankTemplate);
  const [savedId, setSavedId] = useState(templateId ?? "");
  const [categories, setCategories] = useState<Category[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">(templateId ? "loading" : "ready");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"save" | "submit" | "">("");
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<{ templateId: string; status: string; category: string } | null>(null);
  const [languageOption, setLanguageOption] = useState("en");
  const [otherLanguage, setOtherLanguage] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/categories", { cache: "no-store" }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? "Categories could not be loaded.");
        return result.categories as Category[];
      }),
      templateId
        ? fetch(`/api/templates/${templateId}`, { cache: "no-store" }).then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error?.message ?? "Template could not be loaded.");
          return result.template as EditorTemplate;
        })
        : Promise.resolve(null)
    ]).then(([categoryRows, existing]) => {
      if (!active) return;
      setCategories(categoryRows);
      if (existing) {
        if (!("isDraft" in existing) || existing.isDraft !== true) {
          setNotice("Templates already submitted to Meta cannot be edited here. Create a new draft to make changes and submit it for review.");
          setState("error");
          return;
        }
        setTemplate(existing);
        const language = existing.language;
        if (language === "en" || language === "hi") setLanguageOption(language);
        else { setLanguageOption("other"); setOtherLanguage(language); }
      }
      setState("ready");
    }).catch((error: unknown) => {
      if (!active) return;
      setNotice(error instanceof Error ? error.message : "Template editor could not be loaded.");
      setState("error");
    });
    return () => { active = false; };
  }, [templateId]);

  const variables = useMemo(() => [...new Set([...template.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b), [template.body]);
  const language = languageOption === "other" ? otherLanguage.trim().toLowerCase() : languageOption;
  const sampleBody = template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, value: string) => template.variableSamples[value]?.trim() || (value === "1" ? "Alex" : `Sample ${value}`));

  function update<K extends keyof EditorTemplate>(key: K, value: EditorTemplate[K]) {
    setTemplate((current) => ({ ...current, [key]: value }));
  }

  function applyExample(index: number) {
    const example = examples[index];
    if (!example) return;
    const category = categories.find((item) => item.name.toLowerCase() === example.category.toLowerCase());
    setTemplate((current) => ({
      ...current,
      name: example.name,
      body: example.body,
      businessCategoryId: category?._id ?? current.businessCategoryId,
      variableSamples: { ...current.variableSamples, "1": "Alex" },
      variableMappings: [{ number: 1, mapping: "contactPerson" }]
    }));
    setNotice("Example added as an editable draft. It has not been submitted to Meta.");
  }

  function validateBeforeSave() {
    if (!template.name.trim()) return "Template name is required.";
    if (!/^[a-z0-9_]{1,512}$/.test(template.name.trim())) return "Use lowercase letters, numbers, or underscores in the template name.";
    if (!template.body.trim()) return "Message body is required.";
    if (/\{\{|\}\}/.test(template.body.replace(/\{\{\s*\d+\s*\}\}/g, ""))) return "Use numbered variables such as {{1}}.";
    if (variables.some((number, index) => number !== index + 1)) return "Numbered variables must start at {{1}} and continue without gaps.";
    if (variables.some((number) => !template.variableSamples[String(number)]?.trim())) return "Add a sample value for every numbered variable.";
    if (!language || !/^[a-z]{2,3}(?:_[a-z]{2,4})?$/.test(language)) return "Enter a valid Meta language code.";
    return "";
  }

  function payload(): EditorTemplate {
    return { ...template, language };
  }

  async function saveDraft() {
    const validation = validateBeforeSave();
    if (validation) { setNotice(validation); return; }
    setBusy("save");
    setNotice("");
    try {
      const response = await fetch(savedId ? `/api/templates/${savedId}` : "/api/templates", {
        method: savedId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload())
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Draft could not be saved.");
      setTemplate((current) => ({ ...current, ...result.template }));
      if (result.template?._id) setSavedId(result.template._id);
      setNotice("Draft saved. It has not been submitted to Meta.");
      if (!savedId && result.template?._id) window.history.replaceState(null, "", `/dashboard/templates/${result.template._id}/edit`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Draft could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function submitForApproval() {
    if (!savedId) {
      const validation = validateBeforeSave();
      if (validation) { setNotice(validation); setConfirmSubmit(false); return; }
      try {
        setBusy("save");
        const response = await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload())
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? "Draft could not be saved.");
        setTemplate((current) => ({ ...current, ...result.template }));
        const id = result.template?._id as string;
        if (!id) throw new Error("Saved draft did not return an ID.");
        setSavedId(id);
        window.history.replaceState(null, "", `/dashboard/templates/${id}/edit`);
        await submitSavedDraft(id);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Template submission failed.");
        setBusy("");
      }
    } else {
      await submitSavedDraft(savedId);
    }
  }

  async function submitSavedDraft(id: string) {
    setBusy("submit");
    setNotice("");
    setConfirmSubmit(false);
    try {
      const saveResponse = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload())
      });
      const saveResult = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saveResult.error?.message ?? "Draft could not be saved.");
      const response = await fetch(`/api/templates/${id}/submit`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Template submission failed.");
      setSubmissionResult({
        templateId: result.templateId,
        status: result.status,
        category: result.category
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Template submission failed.");
    } finally {
      setBusy("");
    }
  }

  function setSample(number: number, value: string) {
    setTemplate((current) => ({
      ...current,
      variableSamples: { ...current.variableSamples, [String(number)]: value },
      variableMappings: current.variableMappings.some((item) => item.number === number)
        ? current.variableMappings.map((item) => item.number === number ? { ...item, mapping: item.mapping || "" } : item)
        : [...current.variableMappings, { number, mapping: "" }]
    }));
  }

  function setMapping(number: number, mapping: VariableMapping) {
    setTemplate((current) => ({
      ...current,
      variableMappings: [
        ...current.variableMappings.filter((item) => item.number !== number),
        { number, mapping }
      ]
    }));
  }

  function addButton(type: "QUICK_REPLY" | "URL") {
    if (type === "URL" && template.buttons.length) {
      setNotice("Use one website button on its own, or up to three quick reply buttons.");
      return;
    }
    if (type === "QUICK_REPLY" && (template.buttons.length >= 3 || template.buttons.some((button) => button.type === "URL"))) {
      setNotice("Use one website button on its own, or up to three quick reply buttons.");
      return;
    }
    update("buttons", [...template.buttons, {
      type,
      text: type === "URL" ? "Visit Website" : "",
      ...(type === "URL" ? { url: "https://arclivolabs.com/" } : {})
    }]);
  }

  const fieldClass = "mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs outline-none focus:border-[var(--accent)]";
  const labelClass = "text-[11px] font-semibold";

  return (
    <div className="space-y-5">
      <header>
        <Link href="/dashboard/templates" className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={14} /> Back to templates</Link>
        <h1 className="text-[24px] font-semibold tracking-[-0.04em]">{templateId ? "Edit Draft" : "Create Template"}</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">Create an editable draft, preview it, then submit it for Meta review when ready.</p>
      </header>
      {notice && <div role="status" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs">{notice}</div>}
      {submissionResult ? <section role="status" className="surface soft-shadow mx-auto max-w-xl rounded-2xl p-6 sm:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><Send size={19} /></div>
        <h2 className="mt-4 text-lg font-semibold">Submitted to Meta</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Meta accepted the submission request. It has not been marked approved; review status will update when Meta reports it.</p>
        <div className="mt-4 space-y-2 rounded-xl bg-[var(--surface-muted)] p-3 text-xs"><p><span className="text-[var(--muted)]">Meta template ID:</span> {submissionResult.templateId}</p><p><span className="text-[var(--muted)]">Current result:</span> {submissionResult.status}</p><p><span className="text-[var(--muted)]">Category:</span> {submissionResult.category}</p></div>
        <Link href="/dashboard/templates" className="mt-5 inline-flex h-10 items-center rounded-xl bg-[#128c50] px-4 text-xs font-semibold text-white">Return to templates</Link>
      </section> : state === "loading" ? <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,.8fr)]"><div className="surface h-[650px] animate-pulse rounded-2xl" /><div className="surface h-[440px] animate-pulse rounded-2xl" /></div>
        : state === "error" ? <div className="surface rounded-2xl p-6 text-sm">{notice || "Template details could not be loaded."}</div>
          : <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,.8fr)]">
            <section className="surface soft-shadow rounded-2xl p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>Template name<input value={template.name} onChange={(event) => update("name", event.target.value.toLowerCase())} placeholder="e.g. school_promotion" className={fieldClass} maxLength={512} /></label>
                <label className={labelClass}>Business category<select value={template.businessCategoryId} onChange={(event) => update("businessCategoryId", event.target.value)} className={fieldClass}><option value="">Select a category</option>{categories.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label>
                <label className={labelClass}>Template language<select value={languageOption} onChange={(event) => setLanguageOption(event.target.value)} className={fieldClass}><option value="en">English (en)</option><option value="hi">Hindi (hi)</option><option value="other">Other Meta language...</option></select>{languageOption === "other" && <input value={otherLanguage} onChange={(event) => setOtherLanguage(event.target.value)} placeholder="Language code, e.g. en_US" className={fieldClass} />}</label>
                <label className={labelClass}>Meta template category<select value={template.metaCategory} onChange={(event) => update("metaCategory", event.target.value as EditorTemplate["metaCategory"])} className={fieldClass}><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option><option value="AUTHENTICATION">Authentication</option></select><span className="mt-1 block text-[10px] font-normal text-[var(--muted)]">Separate from your business category.</span></label>
              </div>

              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-semibold">Start with a category example</h2><span className="text-[10px] text-[var(--muted)]">Editable · not pre-approved</span></div>
                <div className="flex flex-wrap gap-2">{examples.map((example, index) => <button key={example.name} type="button" onClick={() => applyExample(index)} className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-[10px] font-medium hover:bg-[var(--surface-muted)]">{example.category}</button>)}</div>
              </div>

              <div className="mt-5 space-y-4 border-t border-[var(--border)] pt-4">
                <h2 className="text-xs font-semibold">Message components</h2>
                <label className={labelClass}>Header <span className="font-normal text-[var(--muted)]">(optional text)</span><input value={template.header} onChange={(event) => update("header", event.target.value)} maxLength={60} placeholder="Short message heading" className={fieldClass} /></label>
                <label className={labelClass}>Body <span className="text-rose-600">*</span><textarea value={template.body} onChange={(event) => update("body", event.target.value)} maxLength={1024} rows={8} placeholder="Write the WhatsApp message. Use {{1}}, {{2}}, etc. for variables." className={`${fieldClass} resize-y leading-5`} /><span className="mt-1 block text-right text-[10px] font-normal text-[var(--muted)]">{template.body.length}/1024</span></label>
                <label className={labelClass}>Footer <span className="font-normal text-[var(--muted)]">(optional)</span><input value={template.footer} onChange={(event) => update("footer", event.target.value)} maxLength={60} placeholder="Company signature or opt-out information" className={fieldClass} /></label>
              </div>

              {variables.length > 0 && <div className="mt-5 rounded-xl border border-[var(--border)] p-3.5">
                <div className="flex items-start gap-2"><Info size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" /><div><h2 className="text-xs font-semibold">Variable examples & CRM mappings</h2><p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Meta requires sample values for variables during review. Mappings are stored for later campaign work only.</p></div></div>
                <div className="mt-3 space-y-3">{variables.map((number) => <div key={number} className="grid gap-2 sm:grid-cols-[70px_1fr_150px] sm:items-end">
                  <span className="pb-2 text-[11px] font-semibold">{`{{${number}}}`}</span>
                  <label className="text-[10px] font-medium">Sample value<input value={template.variableSamples[String(number)] ?? ""} onChange={(event) => setSample(number, event.target.value)} placeholder={number === 1 ? "Contact Name" : "Sample value"} className={fieldClass} /></label>
                  <label className="text-[10px] font-medium">CRM field<select value={template.variableMappings.find((item) => item.number === number)?.mapping ?? ""} onChange={(event) => setMapping(number, event.target.value as VariableMapping)} className={fieldClass}><option value="">No mapping</option><option value="contactPerson">Contact Person</option><option value="businessName">Business Name</option><option value="city">City</option></select></label>
                </div>)}</div>
              </div>}

              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <div className="flex items-center justify-between"><div><h2 className="text-xs font-semibold">Buttons <span className="font-normal text-[var(--muted)]">(optional)</span></h2><p className="mt-1 text-[10px] text-[var(--muted)]">Up to 3 quick replies, or one website button.</p></div><div className="flex gap-2"><button type="button" onClick={() => addButton("QUICK_REPLY")} className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-[10px] font-semibold">+ Quick reply</button><button type="button" onClick={() => addButton("URL")} className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-[10px] font-semibold">+ Website</button></div></div>
                <div className="mt-3 space-y-2">{template.buttons.map((button, index) => <div key={index} className="flex items-start gap-2 rounded-xl bg-[var(--surface-muted)] p-3">
                  <div className="grid flex-1 gap-2 sm:grid-cols-2"><label className="text-[10px] font-medium">Button label<input value={button.text} maxLength={25} onChange={(event) => update("buttons", template.buttons.map((item, current) => current === index ? { ...item, text: event.target.value } : item))} className={fieldClass} /></label>{button.type === "URL" && <label className="text-[10px] font-medium">HTTPS website URL<input value={button.url ?? ""} onChange={(event) => update("buttons", template.buttons.map((item, current) => current === index ? { ...item, url: event.target.value } : item))} placeholder="https://example.com" className={fieldClass} /></label>}</div>
                  <button type="button" aria-label="Remove button" onClick={() => update("buttons", template.buttons.filter((_, current) => current !== index))} className="mt-5 rounded-lg p-2 text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-600"><Trash2 size={14} /></button>
                </div>)}</div>
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
                <Link href="/dashboard/templates" className="inline-flex h-10 items-center rounded-xl border border-[var(--border)] px-3.5 text-xs font-semibold">Cancel</Link>
                <button type="button" disabled={Boolean(busy)} onClick={() => void saveDraft()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] px-3.5 text-xs font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50"><Save size={14} />{busy === "save" ? "Saving..." : "Save Draft"}</button>
                <button type="button" disabled={Boolean(busy)} onClick={() => { const error = validateBeforeSave(); if (error) setNotice(error); else setConfirmSubmit(true); }} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#128c50] px-3.5 text-xs font-semibold text-white hover:bg-[#0f7944] disabled:opacity-50"><Send size={14} /> Submit for Approval</button>
              </div>
            </section>

            <aside className="surface soft-shadow overflow-hidden rounded-2xl lg:sticky lg:top-5">
              <div className="border-b border-[var(--border)] px-4 py-3.5"><h2 className="text-xs font-semibold">Live preview</h2><p className="mt-1 text-[10px] text-[var(--muted)]">Preview only · no message will be sent</p></div>
              <div className="min-h-[350px] bg-[#e8eee9] p-4 dark:bg-[#111a14] sm:p-5">
                <div className="mx-auto max-w-[360px] rounded-2xl bg-[#d9fdd3] px-3.5 py-3 text-[#172b19] shadow-sm">
                  {template.header && <p className="mb-2 text-xs font-bold">{template.header}</p>}
                  <p className="whitespace-pre-wrap break-words text-xs leading-[1.65]">{sampleBody || <span className="text-[#59735f]">Your message will appear here...</span>}</p>
                  {template.footer && <p className="mt-2 border-t border-[#b8d9b2] pt-2 text-[10px] text-[#59735f]">{template.footer}</p>}
                  <p className="mt-1 text-right text-[9px] text-[#59735f]">{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                {template.buttons.length > 0 && <div className="mx-auto mt-1.5 max-w-[360px] space-y-1">{template.buttons.map((button, index) => <div key={index} className="rounded-xl bg-white px-3 py-2 text-center text-[11px] font-medium text-[#168451] shadow-sm dark:bg-[#202a22]">{button.text || (button.type === "URL" ? "Visit website" : "Quick reply")}</div>)}</div>}
              </div>
              <div className="space-y-2 border-t border-[var(--border)] p-4 text-[10px] leading-4 text-[var(--muted)]"><p><strong className="text-[var(--foreground)]">Language:</strong> {language || "—"} · <strong className="text-[var(--foreground)]">Category:</strong> {template.metaCategory.toLowerCase()}</p><p><Info size={12} className="mr-1 inline" /> Category examples are editable drafts and are not Meta-approved templates.</p></div>
            </aside>
          </div>}
      {confirmSubmit && <div role="dialog" aria-modal="true" aria-labelledby="submit-title" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
        <div className="surface w-full max-w-md rounded-2xl p-5 shadow-xl"><div className="flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300"><Send size={16} /></span><div><h2 id="submit-title" className="text-sm font-semibold">Submit template for Meta review?</h2><p className="mt-2 text-xs leading-5 text-[var(--muted)]">Meta will review “{template.name || "untitled"}”. Submission does not mean approval. This request is sent to your connected WhatsApp Business Account; no messages will be sent.</p></div></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmSubmit(false)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold">Cancel</button><button type="button" onClick={() => void submitForApproval()} disabled={Boolean(busy)} className="rounded-lg bg-[#128c50] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy === "submit" ? "Submitting..." : "Confirm submission"}</button></div></div>
      </div>}
    </div>
  );
}
