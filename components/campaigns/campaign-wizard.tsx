"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Info, LoaderCircle, Send, X } from "lucide-react";

type Category = { _id: string; name: string; contactCount?: number };
type Template = {
  _id: string;
  name: string;
  businessCategoryId: string;
  businessCategory: string;
  language: string;
  metaCategory: string;
  metaStatus: string;
  body: string;
  header: string;
  footer: string;
  buttons: { type: "QUICK_REPLY" | "URL"; text: string; url?: string }[];
  variables: number[];
  variableSamples: Record<string, string>;
  variableMappings: { number: number; mapping: "contactPerson" | "businessName" | "city" }[];
};
type Recipient = {
  contactId: string;
  businessName: string;
  contactPerson: string;
  phoneNumber: string;
  categoryName: string;
  city: string;
  templateVariables: string[];
};
type Preview = {
  matchingContacts: number;
  eligibleContacts: number;
  excludedContacts: number;
  recipients: Recipient[];
};
type Mapping = { number: number; mapping: "contactPerson" | "businessName" | "city" };
type CampaignDraft = { name: string; description: string; categoryIds: string[]; cities: string[]; templateId: string; variableMappings: Mapping[] };

const blankDraft: CampaignDraft = { name: "", description: "", categoryIds: [], cities: [], templateId: "", variableMappings: [] };
const inputClass = "mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs outline-none focus:border-[var(--accent)]";
const mappingLabels = { contactPerson: "Contact Person Name", businessName: "Business Name", city: "City" };

type WizardProps = { campaignId?: string };

export function CampaignWizard({ campaignId: initialCampaignId }: WizardProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<CampaignDraft>(blankDraft);
  const [campaignId, setCampaignId] = useState(initialCampaignId ?? "");
  const [categories, setCategories] = useState<Category[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("not_connected");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewKey, setPreviewKey] = useState("");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [templatesError, setTemplatesError] = useState("");
  const [busy, setBusy] = useState<"save" | "start" | "">("");
  const [showAudience, setShowAudience] = useState(false);
  const [initialized, setInitialized] = useState(!initialCampaignId);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [categoryResponse, optionsResponse, templatesResponse, campaignResponse] = await Promise.all([
          fetch("/api/categories", { cache: "no-store" }),
          fetch("/api/campaigns/options", { cache: "no-store" }),
          fetch("/api/campaigns/templates", { cache: "no-store" }),
          initialCampaignId ? fetch(`/api/campaigns/${initialCampaignId}`, { cache: "no-store" }) : Promise.resolve(null)
        ]);
        const categoryResult = await categoryResponse.json();
        const optionsResult = await optionsResponse.json();
        const templateResult = await templatesResponse.json();
        if (!categoryResponse.ok) throw new Error(categoryResult.error?.message ?? "Categories could not be loaded.");
        if (!optionsResponse.ok) throw new Error(optionsResult.error?.message ?? "Campaign options could not be loaded.");
        if (!active) return;
        setCategories(categoryResult.categories as Category[]);
        setCities(optionsResult.cities as string[]);
        setConnectionStatus(optionsResult.whatsappStatus);
        if (templatesResponse.ok) setTemplates(templateResult.templates as Template[]);
        else setTemplatesError(templateResult.error?.message ?? "Approved templates could not be loaded.");

        if (initialCampaignId && campaignResponse) {
          const campaignResult = await campaignResponse.json();
          if (!campaignResponse.ok) throw new Error(campaignResult.error?.message ?? "Campaign draft could not be loaded.");
          const existing = campaignResult.campaign;
          if (existing.status !== "Draft") throw new Error("Only draft campaigns can be edited.");
          setDraft({
            name: existing.name,
            description: existing.description ?? "",
            categoryIds: existing.categoryIds.map((id: unknown) => String(id)),
            cities: existing.cities ?? [],
            templateId: existing.templateId ? String(existing.templateId) : "",
            variableMappings: (existing.variableMappings ?? []).map((item: Mapping) => ({ number: item.number, mapping: item.mapping }))
          });
        }
        setInitialized(true);
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Campaign setup could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [initialCampaignId]);

  const availableTemplates = useMemo(() => templates.filter((template) =>
    !template.businessCategoryId || draft.categoryIds.includes(template.businessCategoryId)
  ), [templates, draft.categoryIds]);
  const selectedTemplate = templates.find((item) => item._id === draft.templateId) ?? null;
  const audienceKey = JSON.stringify({
    categoryIds: draft.categoryIds,
    cities: draft.cities,
    templateId: draft.templateId,
    variableMappings: draft.variableMappings
  });

  useEffect(() => {
    if (draft.templateId && !availableTemplates.some((item) => item._id === draft.templateId)) {
      setDraft((current) => ({ ...current, templateId: "", variableMappings: [] }));
      setPreview(null);
    }
  }, [availableTemplates, draft.templateId]);

  const runPreview = useCallback(async () => {
    if (!draft.categoryIds.length) {
      setPreview(null);
      setPreviewKey("");
      setPreviewState("idle");
      return;
    }
    setPreviewState("loading");
    try {
      const response = await fetch("/api/campaigns/preview-audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryIds: draft.categoryIds,
          cities: draft.cities,
          templateId: draft.templateId,
          variableMappings: draft.variableMappings.filter((item) => item.mapping)
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Audience preview failed.");
      setPreview(result as Preview);
      setPreviewKey(audienceKey);
      setPreviewState("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Audience preview failed.");
      setPreviewState("error");
    }
  }, [audienceKey, draft.categoryIds, draft.cities, draft.templateId, draft.variableMappings]);

  useEffect(() => {
    if (step !== 2 && step !== 3) return;
    const timer = setTimeout(() => { void runPreview(); }, 250);
    return () => clearTimeout(timer);
  }, [step, runPreview]);

  function toggleList(field: "categoryIds" | "cities", value: string) {
    setDraft((current) => {
      const selected = current[field];
      return { ...current, [field]: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value] };
    });
  }

  function selectTemplate(id: string) {
    const template = templates.find((item) => item._id === id);
    const variableMappings = template
      ? template.variables.map((number) => ({
        number,
        mapping: template.variableMappings.find((item) => item.number === number)?.mapping ?? "contactPerson" as Mapping["mapping"]
      }))
      : [];
    setDraft((current) => ({ ...current, templateId: id, variableMappings }));
  }

  function changeMapping(number: number, mapping: Mapping["mapping"]) {
    setDraft((current) => ({
      ...current,
      variableMappings: [
        ...current.variableMappings.filter((item) => item.number !== number),
        { number, mapping }
      ]
    }));
  }

  function validateStepOne() {
    if (!draft.name.trim()) return "Campaign name is required.";
    if (draft.name.trim().length > 120) return "Campaign name must be 120 characters or fewer.";
    if (draft.description.trim().length > 1000) return "Description must be 1,000 characters or fewer.";
    return "";
  }

  function validateAudience() {
    if (!draft.categoryIds.length) return "Select at least one business category.";
    if (!draft.templateId || !selectedTemplate) return "Select a currently approved Meta template.";
    if (connectionStatus !== "connected") return "Connect WhatsApp before starting a campaign.";
    if (selectedTemplate.variables.some((number) => !draft.variableMappings.find((item) => item.number === number)?.mapping)) {
      return "Map every variable in the approved template.";
    }
    if (previewState === "loading" || !preview || previewKey !== audienceKey) return "Wait for the audience preview to finish.";
    if (preview.eligibleContacts < 1) return "No eligible recipients match this audience.";
    return "";
  }

  function next() {
    setNotice("");
    if (step === 1) {
      const error = validateStepOne();
      if (error) { setNotice(error); return; }
    }
    if (step === 2) {
      const error = validateAudience();
      if (error) { setNotice(error); return; }
    }
    setStep((current) => Math.min(3, current + 1));
  }

  function requestStart() {
    const error = validateStepOne() || validateAudience();
    if (error) { setNotice(error); return; }
    void startCampaign();
  }

  async function persistDraft() {
    const body = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      variableMappings: draft.variableMappings.filter((item) => item.mapping)
    };
    const response = await fetch(campaignId ? `/api/campaigns/${campaignId}` : "/api/campaigns", {
      method: campaignId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Campaign draft could not be saved.");
    setCampaignId(result.campaign._id);
    return result.campaign._id as string;
  }

  async function saveDraft() {
    const nameError = validateStepOne();
    if (nameError) { setNotice(nameError); return; }
    setBusy("save");
    setNotice("");
    try {
      const id = await persistDraft();
      router.push(`/dashboard/bulk-messaging/${id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaign draft could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function startCampaign() {
    setBusy("start");
    setNotice("");
    try {
      const id = await persistDraft();
      const response = await fetch(`/api/campaigns/${id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Campaign could not be queued.");
      router.push(`/dashboard/bulk-messaging/${id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaign could not be queued.");
    } finally {
      setBusy("");
    }
  }

  const chosenCategories = categories.filter((item) => draft.categoryIds.includes(item._id));
  const sampleMessage = selectedTemplate?.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, value: string) =>
    selectedTemplate.variableSamples[value] || `{{${value}}}`
  ) ?? "";

  if (loading) return <div className="space-y-4"><div className="h-20 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /><div className="h-[560px] animate-pulse rounded-2xl bg-[var(--surface-muted)]" /></div>;

  return (
    <div className="space-y-5">
      <header>
        <Link href="/dashboard/bulk-messaging" className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={14} /> Back to campaigns</Link>
        <h1 className="text-[24px] font-semibold tracking-[-0.04em]">{initialCampaignId ? "Edit Campaign Draft" : "Create New Campaign"}</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">Build a consent-based audience and review before any messages are queued.</p>
      </header>
      {notice && <div role="status" className="flex justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={14} /></button></div>}
      {connectionStatus !== "connected" && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">WhatsApp is not connected. You can prepare a draft, but campaigns cannot be started until the connection is verified.</div>}

      <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--muted)]">
        {["Campaign details", "Audience & template", "Review"].map((label, index) => <div key={label} className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-full ${step === index + 1 ? "bg-[#128c50] text-white" : step > index + 1 ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-muted)]"}`}>{step > index + 1 ? <Check size={12} /> : index + 1}</span><span className="hidden sm:inline">{label}</span>{index < 2 && <ChevronRight size={13} className="mx-1" />}</div>)}
      </div>

      {step === 1 && <section className="surface soft-shadow max-w-2xl rounded-2xl p-4 sm:p-6">
        <h2 className="text-sm font-semibold">Step 1 · Campaign details</h2>
        <p className="mt-1 text-[11px] text-[var(--muted)]">Give your campaign a name so it is easy to identify in history.</p>
        <label className="mt-5 block text-[11px] font-semibold">Campaign name <span className="text-rose-600">*</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={120} placeholder="School Marketing Outreach" className={inputClass} /></label>
        <label className="mt-4 block text-[11px] font-semibold">Description <span className="font-normal text-[var(--muted)]">(optional)</span><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={1000} rows={3} placeholder="Influencer marketing services for educational institutions." className={`${inputClass} resize-y`} /></label>
        <div className="mt-6 flex justify-end"><button type="button" onClick={next} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#128c50] px-4 text-xs font-semibold text-white">Next <ArrowRight size={14} /></button></div>
      </section>}

      {step === 2 && <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
        <section className="surface soft-shadow space-y-5 rounded-2xl p-4 sm:p-5">
          <div><h2 className="text-sm font-semibold">Step 2 · Audience & template</h2><p className="mt-1 text-[11px] text-[var(--muted)]">Only documented opt-in contacts with valid, unsuppressed numbers can be included.</p></div>
          <fieldset><legend className="text-[11px] font-semibold">Business categories <span className="text-rose-600">*</span></legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{categories.map((category) => <label key={category._id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs hover:bg-[var(--surface-muted)]"><input type="checkbox" checked={draft.categoryIds.includes(category._id)} onChange={() => toggleList("categoryIds", category._id)} className="accent-[#128c50]" /><span className="min-w-0 flex-1 truncate">{category.name}</span><span className="text-[10px] text-[var(--muted)]">{category.contactCount ?? 0}</span></label>)}</div>{categories.length === 0 && <p className="mt-2 text-xs text-[var(--muted)]">Add business categories before creating a campaign.</p>}</fieldset>

          <fieldset><legend className="text-[11px] font-semibold">Cities <span className="font-normal text-[var(--muted)]">(optional)</span></legend><p className="mt-1 text-[10px] text-[var(--muted)]">Leave all cities unchecked to include every city in the selected categories.</p><div className="mt-2 max-h-36 overflow-y-auto rounded-xl border border-[var(--border)] p-2">{cities.length ? <div className="grid gap-1.5 sm:grid-cols-2">{cities.map((city) => <label key={city} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--surface-muted)]"><input type="checkbox" checked={draft.cities.includes(city)} onChange={() => toggleList("cities", city)} className="accent-[#128c50]" />{city}</label>)}</div> : <p className="p-2 text-xs text-[var(--muted)]">No cities saved on contacts yet.</p>}</div><p className="mt-1 text-[10px] text-[var(--muted)]">{draft.cities.length ? `${draft.cities.length} cities selected` : "All cities"}</p></fieldset>

          <fieldset><legend className="text-[11px] font-semibold">Approved WhatsApp template <span className="text-rose-600">*</span></legend>
            {templatesError ? <p className="mt-2 rounded-lg bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">{templatesError}</p> : availableTemplates.length === 0 ? <p className="mt-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">No currently approved eligible templates match these categories. Sync and approve a template in Message Templates first.</p> : <div className="mt-2 space-y-2">{availableTemplates.map((template) => <label key={template._id} className={`block cursor-pointer rounded-xl border p-3 transition ${draft.templateId === template._id ? "border-[#128c50] bg-[var(--accent-soft)]" : "border-[var(--border)] hover:bg-[var(--surface-muted)]"}`}><span className="flex items-start gap-2"><input type="radio" name="campaign-template" checked={draft.templateId === template._id} onChange={() => selectTemplate(template._id)} className="mt-0.5 accent-[#128c50]" /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-xs font-semibold">{template.name}<span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] text-emerald-700 dark:text-emerald-300">Approved</span></span><span className="mt-1 block text-[10px] text-[var(--muted)]">{template.businessCategory || "General"} · {template.language} · {template.metaCategory}</span></span></span></label>)}</div>}
          </fieldset>

          {selectedTemplate?.variables.length ? <div className="rounded-xl border border-[var(--border)] p-3.5"><h3 className="text-xs font-semibold">Template variable mapping</h3><p className="mt-1 text-[10px] text-[var(--muted)]">Contacts missing a mapped value will be excluded from this campaign.</p><div className="mt-3 space-y-2">{selectedTemplate.variables.map((number) => <label key={number} className="flex items-center gap-3 text-[11px]"><span className="w-10 font-semibold">{`{{${number}}}`}</span><select value={draft.variableMappings.find((item) => item.number === number)?.mapping ?? ""} onChange={(event) => changeMapping(number, event.target.value as Mapping["mapping"])} className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs"><option value="">Select contact field</option><option value="contactPerson">Contact Person Name</option><option value="businessName">Business Name</option><option value="city">City</option></select></label>)}</div></div> : null}

          {selectedTemplate && <div className="rounded-xl bg-[#e8eee9] p-3 dark:bg-[#111a14]"><p className="mb-2 text-[10px] font-semibold text-[var(--muted)]">Approved template preview</p><div className="ml-auto max-w-[95%] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2.5 text-xs leading-5 text-[#172b19]">{selectedTemplate.header && <strong className="mb-2 block">{selectedTemplate.header}</strong>}{sampleMessage}{selectedTemplate.footer && <span className="mt-2 block border-t border-[#b8d9b2] pt-2 text-[10px]">{selectedTemplate.footer}</span>}</div>{selectedTemplate.buttons.map((button, index) => <p key={index} className="mt-1 rounded-lg bg-white py-2 text-center text-[10px] text-[#168451] dark:bg-[#202a22]">{button.text}</p>)}</div>}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-4"><button type="button" onClick={() => setStep(1)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold"><ArrowLeft size={13} /> Back</button><button type="button" onClick={() => setShowAudience(true)} disabled={!draft.categoryIds.length || previewState === "loading"} className="h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-40">Preview eligible contacts</button><button type="button" onClick={next} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#128c50] px-3.5 text-xs font-semibold text-white">Review <ArrowRight size={13} /></button></div>
        </section>

        <section className="surface soft-shadow rounded-2xl p-4 sm:p-5"><h2 className="text-xs font-semibold">Audience preview</h2><p className="mt-1 text-[10px] text-[var(--muted)]">Live count from saved contacts, consent records, suppression list, and selected template values.</p>
          {previewState === "loading" ? <div className="mt-4 space-y-2">{[0,1,2].map((i)=><div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--surface-muted)]" />)}</div> : preview ? <><div className="mt-4 grid grid-cols-3 gap-2">{[["Matching",preview.matchingContacts],["Eligible",preview.eligibleContacts],["Excluded",preview.excludedContacts]].map(([label,value])=><div key={label} className="rounded-xl bg-[var(--surface-muted)] p-3"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 text-lg font-semibold">{Number(value).toLocaleString()}</p></div>)}</div><div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--border)] p-3 text-[10px] leading-4 text-[var(--muted)]"><Info size={13} className="mt-0.5 shrink-0" />Excludes contacts without documented opt-in, invalid or duplicate numbers, suppressed numbers, and contacts missing required variable values.</div></> : <p className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">Select a category to calculate your audience.</p>}
        </section>
      </div>}

      {step === 3 && <section className="surface soft-shadow max-w-3xl rounded-2xl p-4 sm:p-6">
        <h2 className="text-sm font-semibold">Step 3 · Final review</h2><p className="mt-1 text-[11px] text-[var(--muted)]">Check campaign details before explicitly confirming queueing.</p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-[var(--surface-muted)] p-3"><dt className="text-[10px] text-[var(--muted)]">Campaign name</dt><dd className="mt-1 text-xs font-semibold">{draft.name}</dd></div>
          <div className="rounded-xl bg-[var(--surface-muted)] p-3"><dt className="text-[10px] text-[var(--muted)]">Description</dt><dd className="mt-1 text-xs">{draft.description || "—"}</dd></div>
          <div className="rounded-xl bg-[var(--surface-muted)] p-3"><dt className="text-[10px] text-[var(--muted)]">Selected categories</dt><dd className="mt-1 text-xs font-semibold">{chosenCategories.map((item) => item.name).join(", ") || "—"}</dd></div>
          <div className="rounded-xl bg-[var(--surface-muted)] p-3"><dt className="text-[10px] text-[var(--muted)]">Selected cities</dt><dd className="mt-1 text-xs">{draft.cities.join(", ") || "All cities"}</dd></div>
          <div className="rounded-xl bg-[var(--surface-muted)] p-3"><dt className="text-[10px] text-[var(--muted)]">Approved template</dt><dd className="mt-1 text-xs font-semibold">{selectedTemplate ? `${selectedTemplate.name} · ${selectedTemplate.language} · ${selectedTemplate.metaStatus}` : "—"}</dd></div>
          <div className="rounded-xl bg-[var(--surface-muted)] p-3"><dt className="text-[10px] text-[var(--muted)]">WhatsApp connection</dt><dd className={`mt-1 text-xs font-semibold ${connectionStatus === "connected" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600"}`}>{connectionStatus === "connected" ? "Connected" : "Not connected"}</dd></div>
        </dl>
        <div className="mt-4 grid grid-cols-3 gap-2">{[["Matching contacts",preview?.matchingContacts ?? 0],["Eligible contacts",preview?.eligibleContacts ?? 0],["Excluded contacts",preview?.excludedContacts ?? 0]].map(([label,value])=><div key={label} className="rounded-xl border border-[var(--border)] p-3"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 text-lg font-semibold">{Number(value).toLocaleString()}</p></div>)}</div>
        <p className="mt-3 text-[11px] text-[var(--muted)]"><strong className="text-[var(--foreground)]">Estimated messaging cost:</strong> Cost estimate unavailable.</p>
        <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-[var(--border)] pt-4"><button type="button" onClick={() => setStep(2)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold"><ArrowLeft size={13} /> Back</button><div className="flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => void saveDraft()} className="h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-50">{busy === "save" ? "Saving..." : "Save Draft"}</button><button type="button" disabled={Boolean(busy)} onClick={requestStart} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#128c50] px-3.5 text-xs font-semibold text-white disabled:opacity-50"><Send size={13} /> Start Campaign</button></div></div>
      </section>}

      {showAudience && preview && <div role="dialog" aria-modal="true" aria-label="Eligible recipient preview" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAudience(false); }}><div className="surface max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl shadow-xl"><div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3"><div><h2 className="text-sm font-semibold">Eligible recipient preview</h2><p className="mt-1 text-[10px] text-[var(--muted)]">Showing up to {preview.recipients.length} eligible contacts of {preview.eligibleContacts}.</p></div><button onClick={() => setShowAudience(false)} aria-label="Close preview" className="rounded-lg p-2 hover:bg-[var(--surface-muted)]"><X size={15} /></button></div><div className="max-h-[65vh] overflow-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="sticky top-0 bg-[var(--surface-muted)] text-[10px] uppercase text-[var(--muted)]"><tr><th className="px-4 py-2.5">Business</th><th className="px-3 py-2.5">Contact person</th><th className="px-3 py-2.5">WhatsApp number</th><th className="px-3 py-2.5">Category</th><th className="px-4 py-2.5">City</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{preview.recipients.map((recipient)=><tr key={recipient.contactId}><td className="px-4 py-3 font-medium">{recipient.businessName}</td><td className="px-3 py-3">{recipient.contactPerson || "—"}</td><td className="px-3 py-3">{recipient.phoneNumber}</td><td className="px-3 py-3">{recipient.categoryName}</td><td className="px-4 py-3">{recipient.city || "—"}</td></tr>)}</tbody></table></div></div></div>}

      {!initialized && <span className="sr-only"><LoaderCircle className="animate-spin" /></span>}
    </div>
  );
}
