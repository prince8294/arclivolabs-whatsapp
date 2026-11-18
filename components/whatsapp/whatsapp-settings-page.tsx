"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck
} from "lucide-react";

type ConnectionStatus = {
  status: "not_connected" | "connected" | "error";
  wabaId: string;
  phoneNumberId: string;
  graphApiVersion: string;
  displayName: string;
  displayPhoneNumber: string;
  lastVerifiedAt: string | null;
  lastError: string;
  configured: boolean;
};

type FormFields = {
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  graphApiVersion: string;
};

type TestContact = { id: string; businessName: string; phoneNumber: string };
type ApprovedTemplate = { name: string; language: string };

const initialForm: FormFields = {
  wabaId: "",
  phoneNumberId: "",
  accessToken: "",
  appSecret: "",
  verifyToken: "",
  graphApiVersion: ""
};

const inputClass =
  "mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3.5 py-2.5 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]";
const labelClass = "block text-xs font-medium text-[var(--foreground)]";
const secondaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-xs font-medium transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50";

function responseMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return fallback;
}

async function loadStatus(): Promise<ConnectionStatus> {
  const response = await fetch("/api/whatsapp/status", { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.status) {
    throw new Error(responseMessage(result, "Could not load WhatsApp connection status."));
  }
  return result.status as ConnectionStatus;
}

function StatusBadge({ status }: { status: ConnectionStatus["status"] }) {
  const presentation = {
    connected: { label: "Connected", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
    error: { label: "Connection Error", className: "bg-red-500/10 text-red-700 dark:text-red-300", icon: AlertCircle },
    not_connected: { label: "Not Connected", className: "bg-[var(--surface-muted)] text-[var(--muted)]", icon: AlertCircle }
  }[status];
  const Icon = presentation.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium ${presentation.className}`}>
      <Icon size={13} />
      {presentation.label}
    </span>
  );
}

export function WhatsAppSettingsPage() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [form, setForm] = useState<FormFields>(initialForm);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [editingCredentials, setEditingCredentials] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [webhookCopied, setWebhookCopied] = useState(false);

  const [recipientSearch, setRecipientSearch] = useState("");
  const [contacts, setContacts] = useState<TestContact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [testError, setTestError] = useState("");

  const [webhookUrl, setWebhookUrl] = useState("");
  const selectedTemplateValue = useMemo(
    () => templates.find((template) => `${template.name}|${template.language}` === selectedTemplate),
    [selectedTemplate, templates]
  );

  const refreshStatus = useCallback(async () => {
    try {
      const next = await loadStatus();
      setStatus(next);
      setForm((current) => ({
        ...current,
        wabaId: next.wabaId || current.wabaId,
        phoneNumberId: next.phoneNumberId || current.phoneNumberId,
        graphApiVersion: next.graphApiVersion || current.graphApiVersion
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load WhatsApp connection status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/webhooks/whatsapp`);
  }, []);

  useEffect(() => {
    if (status?.status !== "connected") return;
    let active = true;
    const controller = new AbortController();
    const query = recipientSearch.trim();
    const timer = window.setTimeout(async () => {
      try {
        const contactsResponse = await fetch(
          `/api/whatsapp/test-contacts${query ? `?search=${encodeURIComponent(query)}` : ""}`,
          { signal: controller.signal, cache: "no-store" }
        );
        const contactsResult = await contactsResponse.json();
        if (!contactsResponse.ok) throw new Error(responseMessage(contactsResult, "Could not load eligible contacts."));
        if (active) {
          setContacts(Array.isArray(contactsResult.contacts) ? contactsResult.contacts : []);
        }
      } catch (reason) {
        if (active && !controller.signal.aborted) {
          setTestError(reason instanceof Error ? reason.message : "Could not load test-message options.");
        }
      }
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [recipientSearch, status?.status]);

  useEffect(() => {
    if (status?.status !== "connected") return;
    const controller = new AbortController();
    void fetch("/api/whatsapp/templates", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(responseMessage(result, "Could not load approved templates."));
        setTemplates(Array.isArray(result.templates) ? result.templates : []);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setTestError(reason instanceof Error ? reason.message : "Could not load approved templates.");
        }
      });
    return () => controller.abort();
  }, [status?.status]);

  function updateField(key: keyof FormFields, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(responseMessage(result, "Could not verify the Meta connection."));
      setForm((current) => ({ ...initialForm, wabaId: current.wabaId, phoneNumberId: current.phoneNumberId }));
      setEditingCredentials(false);
      setNotice("Meta verified the WhatsApp Business Account and phone number.");
      await refreshStatus();
      window.dispatchEvent(new Event("whatsapp-status-updated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not verify the Meta connection.");
      await refreshStatus();
      window.dispatchEvent(new Event("whatsapp-status-updated"));
    } finally {
      setSubmitting(false);
    }
  }

  async function testConnection() {
    setError("");
    setNotice("");
    setTesting(true);
    try {
      const response = await fetch("/api/whatsapp/test-connection", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(responseMessage(result, "Connection test failed."));
      setNotice("Connection verified successfully with Meta.");
      await refreshStatus();
      window.dispatchEvent(new Event("whatsapp-status-updated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection test failed.");
      await refreshStatus();
      window.dispatchEvent(new Event("whatsapp-status-updated"));
    } finally {
      setTesting(false);
    }
  }

  async function sendTestMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTestError("");
    setTestResult("");
    if (!selectedContactId || !selectedTemplateValue) {
      setTestError("Choose an opted-in contact and an approved template.");
      return;
    }

    setSendingTest(true);
    try {
      const response = await fetch("/api/whatsapp/test-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: selectedContactId,
          templateName: selectedTemplateValue.name,
          templateLanguage: selectedTemplateValue.language,
          requestId: crypto.randomUUID()
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(responseMessage(result, "Could not send the test message."));
      setTestResult(`${result.message} Message ID: ${result.messageId}`);
    } catch (reason) {
      setTestError(reason instanceof Error ? reason.message : "Could not send the test message.");
      window.dispatchEvent(new Event("whatsapp-status-updated"));
    } finally {
      setSendingTest(false);
    }
  }

  async function copyWebhookUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setWebhookCopied(true);
      window.setTimeout(() => setWebhookCopied(false), 1800);
    } catch {
      setError("Could not copy the webhook URL. You can select and copy it manually.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Workspace settings</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">WhatsApp Integration</h2>
          <p className="mt-1.5 max-w-2xl text-sm text-[var(--muted)]">
            Connect your Meta WhatsApp Business account, verify its phone number, and configure webhook events.
          </p>
        </div>
        {status && <StatusBadge status={status.status} />}
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>}
      {status?.status === "error" && status.lastError && !error && (
        <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300">{status.lastError}</div>
      )}

      <section className="surface soft-shadow rounded-2xl border border-[var(--border)] p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <MessageCircle size={19} />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Meta WhatsApp Cloud API</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">
                Credentials are encrypted on the server and never returned to this page. A successful status is saved only after Meta confirms both the account and phone number.
              </p>
            </div>
          </div>
          {status?.status === "connected" && !editingCredentials && (
            <div className="flex gap-2">
              <button type="button" onClick={() => void testConnection()} disabled={testing} className={secondaryButton}>
                {testing ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Test Connection
              </button>
              <button type="button" onClick={() => setEditingCredentials(true)} className={secondaryButton}>
                Update Credentials
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="mt-6 h-24 animate-pulse rounded-xl bg-[var(--surface-muted)]" />
        ) : status?.status === "connected" && !editingCredentials ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="WhatsApp Business Display Name" value={status.displayName || "Not provided by Meta"} />
            <Detail label="Connected Phone Number" value={status.displayPhoneNumber || "Not provided by Meta"} />
            <Detail label="WhatsApp Business Account ID" value={status.wabaId} />
            <Detail label="Phone Number ID" value={status.phoneNumberId} />
            <Detail label="Connection Status" value="Verified with Meta" />
            <Detail
              label="Last Verified"
              value={status.lastVerifiedAt ? new Date(status.lastVerifiedAt).toLocaleString() : "Not verified"}
            />
          </div>
        ) : (
          <form onSubmit={submitConfiguration} className="mt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="WhatsApp Business Account ID (WABA ID)" value={form.wabaId} onChange={(value) => updateField("wabaId", value)} required />
              <Field label="Phone Number ID" value={form.phoneNumberId} onChange={(value) => updateField("phoneNumberId", value)} required />
              <SecretField label="Meta Access Token" value={form.accessToken} onChange={(value) => updateField("accessToken", value)} visible={Boolean(visibleSecrets.accessToken)} onToggle={() => setVisibleSecrets((current) => ({ ...current, accessToken: !current.accessToken }))} configured={Boolean(status?.configured)} />
              <SecretField label="Meta App Secret" value={form.appSecret} onChange={(value) => updateField("appSecret", value)} visible={Boolean(visibleSecrets.appSecret)} onToggle={() => setVisibleSecrets((current) => ({ ...current, appSecret: !current.appSecret }))} configured={Boolean(status?.configured)} />
              <SecretField label="Webhook Verify Token" value={form.verifyToken} onChange={(value) => updateField("verifyToken", value)} visible={Boolean(visibleSecrets.verifyToken)} onToggle={() => setVisibleSecrets((current) => ({ ...current, verifyToken: !current.verifyToken }))} configured={Boolean(status?.configured)} />
              <Field label="Graph API Version" value={form.graphApiVersion} onChange={(value) => updateField("graphApiVersion", value)} placeholder="vXX.X" required />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#075E54] px-4 text-xs font-semibold text-white transition hover:bg-[#064e46] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <LoaderCircle size={15} className="animate-spin" />}
                {status?.status === "connected" ? "Verify and Replace Credentials" : "Connect WhatsApp"}
              </button>
              {editingCredentials && (
                <button type="button" onClick={() => { setEditingCredentials(false); setError(""); }} className={secondaryButton}>
                  Cancel
                </button>
              )}
            </div>
            <p className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-[var(--muted)]">
              <LockKeyhole size={13} className="mt-0.5 shrink-0" />
              Leave secret fields blank to keep the current server-side values. To replace a secret, enter its new value; the current value cannot be viewed.
            </p>
          </form>
        )}
      </section>

      <section className="surface rounded-2xl border border-[var(--border)] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-[var(--muted)]">
            <ShieldCheck size={17} />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Webhook Configuration</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Set this callback URL in your Meta App webhook settings, subscribe to the WhatsApp Business Account fields, and use the exact verify token configured above.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className={labelClass} htmlFor="whatsapp-webhook-url">Callback URL</label>
            <input id="whatsapp-webhook-url" readOnly value={webhookUrl} className={`${inputClass} font-mono text-xs`} />
          </div>
          <button type="button" onClick={() => void copyWebhookUrl()} className={secondaryButton}>
            <Clipboard size={14} /> {webhookCopied ? "Copied" : "Copy URL"}
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
          The endpoint verifies Meta signatures against the App Secret and acknowledges valid webhook events. Use a public HTTPS URL in production. No automatic replies are sent.
        </p>
      </section>

      {status?.status === "connected" && (
        <section className="surface rounded-2xl border border-[var(--border)] p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Send size={16} />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Manual Test Message</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Send one approved template to a CRM contact with documented Opted In consent. This does not start a campaign.
              </p>
            </div>
          </div>

          {testError && <p role="alert" className="mt-4 rounded-lg bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">{testError}</p>}
          {testResult && <p role="status" className="mt-4 rounded-lg bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">{testResult}</p>}

          <form onSubmit={sendTestMessage} className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="test-recipient-search">Test Recipient</label>
              <input
                id="test-recipient-search"
                value={recipientSearch}
                onChange={(event) => { setRecipientSearch(event.target.value); setSelectedContactId(""); }}
                placeholder="Search opted-in contacts"
                className={inputClass}
              />
              <select
                aria-label="Select opted-in test recipient"
                value={selectedContactId}
                onChange={(event) => setSelectedContactId(event.target.value)}
                className={inputClass}
                required
              >
                <option value="">Select a recipient</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>{contact.businessName} — {contact.phoneNumber}</option>
                ))}
              </select>
              {contacts.length === 0 && <p className="mt-1.5 text-[10px] text-[var(--muted)]">No eligible opted-in contacts found.</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="test-template">Approved Test Template</label>
              <select
                id="test-template"
                value={selectedTemplate}
                onChange={(event) => setSelectedTemplate(event.target.value)}
                className={inputClass}
                required
              >
                <option value="">Select an approved template</option>
                {templates.map((template) => {
                  const key = `${template.name}|${template.language}`;
                  return <option key={key} value={key}>{template.name} ({template.language})</option>;
                })}
              </select>
              {templates.length === 0 && <p className="mt-1.5 text-[10px] text-[var(--muted)]">No approved text templates without parameters are available.</p>}
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={sendingTest || !selectedContactId || !selectedTemplate}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#075E54] px-4 text-xs font-semibold text-white transition hover:bg-[#064e46] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sendingTest ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
                Send Test Message
              </button>
            </div>
          </form>
          <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
            Meta restrictions and delivery outcomes apply. If a request times out, check WhatsApp before creating another request to avoid duplicate sends.
          </p>
        </section>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
      <p className="text-[10px] font-medium text-[var(--muted)]">{label}</p>
      <p className="mt-1 break-all text-xs font-medium">{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className={labelClass}>
        {label}
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          className={inputClass}
        />
      </label>
    </div>
  );
}

function SecretField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  configured
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  configured: boolean;
}) {
  return (
    <div>
      <label className={labelClass}>
        {label}
        <span className="relative mt-1.5 block">
          <input
            type={visible ? "text" : "password"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={configured ? "Configured securely — enter a replacement or leave blank" : "Enter secret"}
            required={!configured}
            autoComplete="new-password"
            className={`${inputClass} pr-10`}
          />
          <button
            type="button"
            onClick={onToggle}
            aria-label={visible ? `Hide ${label}` : `Show ${label}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {visible ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </span>
      </label>
    </div>
  );
}
