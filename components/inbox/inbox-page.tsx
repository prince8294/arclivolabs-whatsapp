"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CircleAlert,
  LoaderCircle,
  MessageSquareText,
  Search,
  Send,
  UserPlus,
  X
} from "lucide-react";

type LeadStatus = "New" | "Interested" | "Not Interested" | "Closed";
type ConversationItem = {
  _id: string;
  contactId: string;
  phoneNumber: string;
  businessName: string;
  contactName: string;
  categoryName: string;
  city: string;
  lastMessage: string;
  lastMessageAt: string | null;
  lastIncomingMessageAt: string | null;
  unreadCount: number;
  leadStatus: LeadStatus;
  leadStatusUpdatedAt: string | null;
  notes: string;
};
type MessageItem = {
  _id: string;
  messageId: string;
  direction: "incoming" | "outgoing";
  type: string;
  text: string;
  status: string;
  timestamp: string;
  isReadInternally: boolean;
  failureMessage: string;
};
type TemplateChoice = {
  _id: string;
  name: string;
  language: string;
  body: string;
  header: string;
  footer: string;
  variables: number[];
  buttons: { type: "QUICK_REPLY" | "URL"; text: string; url?: string }[];
};
type CategoryOption = { _id: string; name: string };
type ApiError = { error?: { code?: string; message?: string } };

const filters = ["all", "unread", "interested"] as const;
const leadStatuses: LeadStatus[] = ["New", "Interested", "Not Interested", "Closed"];

function messageTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function chatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function displayName(conversation: ConversationItem) {
  return conversation.businessName || conversation.contactName || conversation.phoneNumber;
}

function responseError(result: ApiError, fallback: string) {
  return result.error?.message || fallback;
}

function conversationTitle(conversation: ConversationItem) {
  return conversation.contactName && conversation.businessName
    ? `${conversation.contactName} · ${conversation.businessName}`
    : displayName(conversation);
}

function leadTone(status: string) {
  if (status === "Interested") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "Not Interested") return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (status === "Closed") return "bg-[var(--surface-muted)] text-[var(--muted)]";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function MessageStatus({ status }: { status: string }) {
  if (status === "read") return <CheckCheck size={13} className="text-sky-600 dark:text-sky-300" aria-label="Read" />;
  if (status === "delivered") return <CheckCheck size={13} className="text-[var(--muted)]" aria-label="Delivered" />;
  if (status === "sent") return <Check size={13} className="text-[var(--muted)]" aria-label="Sent" />;
  if (status === "failed") return <CircleAlert size={13} className="text-rose-500" aria-label="Failed" />;
  return <Check size={13} className="text-[var(--muted)]" aria-label="Pending" />;
}

export function InboxPage({ initialConversationId = "" }: { initialConversationId?: string }) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listPage, setListPage] = useState(1);
  const [listTotalPages, setListTotalPages] = useState(1);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [messagePage, setMessagePage] = useState(1);
  const [messageTotalPages, setMessageTotalPages] = useState(1);
  const [replyWindowOpen, setReplyWindowOpen] = useState(false);
  const [hasUncertainSend, setHasUncertainSend] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [templateMode, setTemplateMode] = useState(false);
  const [templates, setTemplates] = useState<TemplateChoice[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [templateVariables, setTemplateVariables] = useState<string[]>([]);
  const [statusSaving, setStatusSaving] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [contactBusiness, setContactBusiness] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [contactCategoryId, setContactCategoryId] = useState("");
  const [contactCity, setContactCity] = useState("");
  const [contactSaving, setContactSaving] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selected = conversations.find((item) => item._id === selectedId) ?? null;
  const selectedTemplate = templates.find((item) => item._id === templateId) ?? null;
  const windowLabel = useMemo(() => selected?.lastIncomingMessageAt
    ? `Last customer reply ${chatTime(selected.lastIncomingMessageAt)}`
    : "No incoming WhatsApp reply stored yet", [selected?.lastIncomingMessageAt]);

  const loadConversations = useCallback(async (signal?: AbortSignal, page = 1, append = false) => {
    const params = new URLSearchParams({ filter, search, page: String(page) });
    if (initialConversationId) params.set("conversationId", initialConversationId);
    const response = await fetch(`/api/inbox/conversations?${params}`, { cache: "no-store", signal });
    const result = await response.json() as { conversations?: ConversationItem[]; totalPages?: number } & ApiError;
    if (!response.ok) throw new Error(responseError(result, "Inbox conversations could not be loaded."));
    const loaded = result.conversations ?? [];
    setConversations((current) => {
      if (append) {
        const byId = new Map(current.map((item) => [item._id, item]));
        for (const item of loaded) byId.set(item._id, item);
        return [...byId.values()];
      }
      const loadedIds = new Set(loaded.map((item) => item._id));
      return [...loaded, ...current.filter((item) => !loadedIds.has(item._id))]
        .sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime());
    });
    setListTotalPages(result.totalPages ?? 1);
    if (append) setListPage(page);
    setListState("ready");
    if (!append && selectedId && loaded.some((item) => item._id === selectedId && item.unreadCount > 0)) {
      void fetch(`/api/inbox/conversations/${selectedId}/mark-read`, { method: "POST" })
        .then(async (markResponse) => {
          if (!markResponse.ok) {
            const markResult = await markResponse.json() as ApiError;
            throw new Error(responseError(markResult, "Conversation could not be marked read."));
          }
          setConversations((items) => items.map((item) => item._id === selectedId ? { ...item, unreadCount: 0 } : item));
        })
        .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Conversation could not be marked read."));
    }
  }, [filter, initialConversationId, search, selectedId]);

  const loadMessages = useCallback(async (page: number, signal?: AbortSignal) => {
    if (!selectedId) return;
    const response = await fetch(`/api/inbox/conversations/${selectedId}/messages?page=${page}`, { cache: "no-store", signal });
    const result = await response.json() as {
      messages?: MessageItem[];
      totalPages?: number;
      replyWindowOpen?: boolean;
      hasUncertainSend?: boolean;
    } & ApiError;
    if (!response.ok) throw new Error(responseError(result, "Message history could not be loaded."));
    const loadedMessages = result.messages ?? [];
    setMessages((current) => {
      const byId = new Map(current.map((item) => [item._id, item]));
      for (const item of loadedMessages) byId.set(item._id, item);
      return [...byId.values()].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    });
    setMessagePage(page);
    setMessageTotalPages(result.totalPages ?? 1);
    setReplyWindowOpen(result.replyWindowOpen === true);
    setHasUncertainSend(result.hasUncertainSend === true);
    if (page === 1) window.setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 40);
  }, [selectedId]);

  async function loadEarlierMessages() {
    try {
      await loadMessages(messagePage + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Earlier messages could not be loaded.");
    }
  }

  async function retryConversations() {
    setListState("loading");
    try {
      await loadConversations();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Inbox conversations could not be loaded.");
      setListState("error");
    }
  }

  async function loadMoreConversations() {
    try {
      await loadConversations(undefined, listPage + 1, true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "More conversations could not be loaded.");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    setSelectedId("");
    setMobileChatOpen(false);
    setConversations([]);
    setListPage(1);
  }, [filter, search]);

  useEffect(() => {
    if (!initialConversationId || !conversations.some((item) => item._id === initialConversationId) || selectedId === initialConversationId) return;
    setSelectedId(initialConversationId);
    setMobileChatOpen(true);
  }, [conversations, initialConversationId, selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        await loadConversations(controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        setNotice(error instanceof Error ? error.message : "Inbox conversations could not be loaded.");
        setListState("error");
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setReplyWindowOpen(false);
      setHasUncertainSend(false);
      return;
    }
    setMessages([]);
    setMessagePage(1);
    const controller = new AbortController();
    async function refresh() {
      try {
        await loadMessages(1, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Conversation could not be refreshed.");
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadMessages, selectedId]);

  function selectConversation(conversation: ConversationItem) {
    setSelectedId(conversation._id);
    setMobileChatOpen(true);
    setNotice("");
    setTemplateMode(false);
    setTemplateId("");
    setTemplateVariables([]);
    setNotesDraft(conversation.notes ?? "");
    setConversations((items) => items.map((item) => item._id === conversation._id ? { ...item, unreadCount: 0 } : item));
  }

  async function sendText(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim() || sending || !replyWindowOpen) return;
    await sendMessage({ type: "text", text: draft.trim() }, () => setDraft(""));
  }

  async function sendMessage(payload: Record<string, unknown>, afterSent: () => void) {
    if (!selected) return;
    setSending(true);
    setNotice("");
    const text = typeof payload.text === "string" ? payload.text : "";
    try {
      const response = await fetch(`/api/inbox/conversations/${selected._id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId: crypto.randomUUID() })
      });
      const result = await response.json() as { messageId?: string; status?: string } & ApiError & { error?: { code?: string; message?: string } };
      if (!response.ok) {
        if (["META_UNCONFIRMED_RESPONSE", "SEND_RESULT_UNCERTAIN", "UNRESOLVED_SEND"].includes(result.error?.code ?? "")) {
          setHasUncertainSend(true);
        }
        throw new Error(responseError(result, "Message could not be sent."));
      }
      const outgoingText = text || (selectedTemplate
        ? [selectedTemplate.header, selectedTemplate.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) => templateVariables[Number(number) - 1] ?? ""), selectedTemplate.footer].filter(Boolean).join("\n\n")
        : "");
      const now = new Date().toISOString();
      setMessages((items) => [...items, {
        _id: result.messageId || crypto.randomUUID(),
        messageId: result.messageId ?? "",
        direction: "outgoing",
        type: selectedTemplate && !text ? "template" : "text",
        text: outgoingText,
        status: "pending",
        timestamp: now,
        isReadInternally: true,
        failureMessage: ""
      }]);
      setHasUncertainSend(false);
      setConversations((items) => items.map((item) => item._id === selected._id
        ? { ...item, lastMessage: outgoingText, lastMessageAt: now }
        : item));
      afterSent();
      setTemplateMode(false);
      setTemplateId("");
      setTemplateVariables([]);
      window.setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 40);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function loadTemplates() {
    setTemplateMode(true);
    if (templates.length || templatesLoading) return;
    setTemplatesLoading(true);
    try {
      const response = await fetch("/api/campaigns/templates", { cache: "no-store" });
      const result = await response.json() as { templates?: TemplateChoice[] } & ApiError;
      if (!response.ok) throw new Error(responseError(result, "Approved templates could not be loaded."));
      setTemplates(result.templates ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Approved templates could not be loaded.");
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function resolveUncertainSend() {
    if (!selected || !window.confirm("Only continue if you checked WhatsApp and verified that the uncertain message was not delivered. This does not recall a message.")) return;
    try {
      const response = await fetch(`/api/inbox/conversations/${selected._id}/resolve-uncertain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmNoDelivery: true })
      });
      const result = await response.json() as ApiError;
      if (!response.ok) throw new Error(responseError(result, "The uncertain send could not be resolved."));
      setHasUncertainSend(false);
      setNotice("Uncertain send reviewed. You may send a new manual message.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The uncertain send could not be resolved.");
    }
  }

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((item) => item._id === id);
    setTemplateVariables(template?.variables.map(() => "") ?? []);
  }

  async function sendTemplate(event: FormEvent) {
    event.preventDefault();
    if (!selectedTemplate || sending) return;
    await sendMessage({ type: "template", templateId: selectedTemplate._id, variables: templateVariables }, () => {});
  }

  async function updateLeadStatus(leadStatus: LeadStatus) {
    if (!selected) return;
    setStatusSaving(true);
    try {
      const response = await fetch(`/api/inbox/conversations/${selected._id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadStatus })
      });
      const result = await response.json() as ApiError & { leadStatusUpdatedAt?: string | null };
      if (!response.ok) throw new Error(responseError(result, "Lead status could not be updated."));
      setConversations((items) => items.map((item) => item._id === selected._id ? {
        ...item,
        leadStatus,
        leadStatusUpdatedAt: result.leadStatusUpdatedAt ?? new Date().toISOString()
      } : item));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Lead status could not be updated.");
    } finally {
      setStatusSaving(false);
    }
  }

  async function saveNotes() {
    if (!selected) return;
    setNotesSaving(true);
    try {
      const response = await fetch(`/api/inbox/conversations/${selected._id}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesDraft })
      });
      const result = await response.json() as { notes?: string } & ApiError;
      if (!response.ok) throw new Error(responseError(result, "Notes could not be saved."));
      setConversations((items) => items.map((item) => item._id === selected._id ? { ...item, notes: result.notes ?? "" } : item));
      setNotice("Notes saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Notes could not be saved.");
    } finally {
      setNotesSaving(false);
    }
  }

  async function openAddContact() {
    if (!selected) return;
    setContactBusiness(selected.businessName || selected.contactName || "");
    setContactPerson(selected.contactName || "");
    setContactCity(selected.city || "");
    setAddContactOpen(true);
    try {
      const response = await fetch("/api/categories", { cache: "no-store" });
      const result = await response.json() as { categories?: CategoryOption[] } & ApiError;
      if (!response.ok) throw new Error(responseError(result, "Categories could not be loaded."));
      setCategories(result.categories ?? []);
      setContactCategoryId(result.categories?.[0]?._id ?? "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Categories could not be loaded.");
    }
  }

  async function addContact(event: FormEvent) {
    event.preventDefault();
    if (!selected || contactSaving) return;
    setContactSaving(true);
    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: contactBusiness,
          contactPerson,
          phoneNumber: selected.phoneNumber,
          categoryId: contactCategoryId,
          city: contactCity,
          marketingConsentStatus: "Unknown"
        })
      });
      const result = await response.json() as ApiError;
      if (!response.ok) throw new Error(responseError(result, "Contact could not be added."));
      setAddContactOpen(false);
      setNotice("Contact added. Marketing consent remains Unknown.");
      await loadConversations();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Contact could not be added.");
    } finally {
      setContactSaving(false);
    }
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const details = selected ? (
    <div className="space-y-4">
      {!selected.contactId && <button type="button" onClick={() => void openAddContact()} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold hover:bg-[var(--surface-muted)]"><UserPlus size={14} /> Add to Contacts</button>}
      <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Business Name</p><p className="mt-1 text-xs font-medium">{selected.businessName || "Not in Contacts"}</p></div>
      <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Contact Person</p><p className="mt-1 text-xs">{selected.contactName || "—"}</p></div>
      <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">WhatsApp Number</p><p className="mt-1 text-xs">{selected.phoneNumber}</p></div>
      <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Business Category</p><p className="mt-1 text-xs">{selected.categoryName || "—"}</p></div>
      <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">City</p><p className="mt-1 text-xs">{selected.city || "—"}</p></div>
      <label className="block"><span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Lead Status</span>
        <select value={selected.leadStatus} disabled={statusSaving} onChange={(event) => void updateLeadStatus(event.target.value as LeadStatus)} className="mt-1.5 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs">
          {leadStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        {selected.leadStatusUpdatedAt && <span className="mt-1 block text-[9px] text-[var(--muted)]">Updated {chatTime(selected.leadStatusUpdatedAt)}</span>}
      </label>
      <label className="block"><span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Notes</span>
        <textarea value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} maxLength={2000} rows={4} className="mt-1.5 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs outline-none focus:border-[var(--accent)]" placeholder="Add internal notes…" />
      </label>
      <button type="button" disabled={notesSaving || notesDraft === selected.notes} onClick={() => void saveNotes()} className="h-8 rounded-lg border border-[var(--border)] px-3 text-[11px] font-semibold disabled:opacity-40">{notesSaving ? "Saving…" : "Save notes"}</button>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-[22px] font-semibold tracking-[-0.04em]">WhatsApp Inbox</h2><p className="mt-1 text-xs text-[var(--muted)]">Incoming replies and manual customer conversations.</p></div>
        <a href="/dashboard/settings/whatsapp" className="text-[11px] font-semibold text-[var(--accent)]">Connection settings</a>
      </div>
      {notice && <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></div>}

      <section className="grid min-h-[min(760px,calc(100vh-190px))] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_270px]">
        <aside className={`${mobileChatOpen ? "hidden lg:flex" : "flex"} min-h-[520px] flex-col border-r border-[var(--border)]`}>
          <div className="border-b border-[var(--border)] p-4">
            <label className="flex h-9 items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-3 text-[var(--muted)]">
              <Search size={14} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search name or number" className="min-w-0 flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]" />
            </label>
            <div className="mt-3 flex gap-1">
              {filters.map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold capitalize transition ${filter === item ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-[var(--surface-muted)]"}`}>{item === "all" ? "All Chats" : item[0].toUpperCase() + item.slice(1)}</button>)}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {listState === "loading" ? <div className="space-y-2 p-3" aria-label="Loading conversations">{[0, 1, 2, 3].map((item) => <div key={item} className="h-[66px] animate-pulse rounded-lg bg-[var(--surface-muted)]" />)}</div>
              : listState === "error" ? <div className="p-6 text-center text-xs text-[var(--muted)]">Conversations could not be loaded. <button onClick={() => void retryConversations()} className="font-semibold text-[var(--accent)]">Try again</button></div>
                : conversations.length === 0 ? <div className="px-5 py-14 text-center"><MessageSquareText size={22} className="mx-auto text-[var(--muted)]" /><p className="mt-3 text-xs font-semibold">No conversations yet</p><p className="mt-1 text-[10px] leading-5 text-[var(--muted)]">Replies received through the signed Meta webhook will appear here.</p></div>
                  : conversations.map((conversation) => <button key={conversation._id} type="button" onClick={() => void selectConversation(conversation)} className={`flex w-full items-start gap-3 border-b border-[var(--border)] px-4 py-3.5 text-left transition hover:bg-[var(--surface-muted)] ${selectedId === conversation._id ? "bg-[var(--accent-soft)]/60" : ""}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-xs font-semibold text-[var(--accent)]">{displayName(conversation).slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold">{displayName(conversation)}</span><span className="shrink-0 text-[9px] text-[var(--muted)]">{messageTime(conversation.lastMessageAt)}</span></span><span className="mt-1 block truncate text-[10px] text-[var(--muted)]">{conversation.lastMessage || conversation.phoneNumber}</span><span className="mt-2 flex items-center justify-between"><span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${leadTone(conversation.leadStatus)}`}>{conversation.leadStatus}</span>{conversation.unreadCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#128c50] px-1 text-[9px] font-bold text-white">{conversation.unreadCount}</span>}</span></span>
                      </button>)}
          </div>
          {listPage < listTotalPages && <button type="button" onClick={() => void loadMoreConversations()} className="m-3 rounded-lg border border-[var(--border)] py-2 text-[10px] font-semibold text-[var(--muted)] hover:bg-[var(--surface-muted)]">Load more conversations</button>}
        </aside>

        <main className={`${mobileChatOpen ? "flex" : "hidden lg:flex"} min-h-[520px] min-w-0 flex-col bg-[var(--background)]`}>
          {selected ? <>
            <header className="flex h-[64px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4">
              <button type="button" onClick={() => setMobileChatOpen(false)} aria-label="Back to conversations" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)] lg:hidden"><ArrowLeft size={17} /></button>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-muted)] text-xs font-semibold text-[var(--accent)]">{displayName(selected).slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{conversationTitle(selected)}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{selected.phoneNumber}</p></div>
              <span className={`hidden rounded-full px-2.5 py-1 text-[9px] font-semibold sm:inline-flex ${leadTone(selected.leadStatus)}`}>{selected.leadStatus}</span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-5">
              {messagePage < messageTotalPages && <button type="button" onClick={() => void loadEarlierMessages()} className="mx-auto mb-4 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">Load earlier messages</button>}
              {messages.length === 0 ? <div className="m-auto max-w-xs text-center"><MessageSquareText size={25} className="mx-auto text-[var(--muted)]" /><p className="mt-3 text-xs font-semibold">No stored messages</p><p className="mt-1 text-[10px] leading-5 text-[var(--muted)]">Only messages received or sent through this workspace are shown.</p></div>
                : <div className="space-y-2.5">{messages.map((message) => {
                  const outgoing = message.direction === "outgoing";
                  return <div key={message._id} className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[84%] rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[75%] ${outgoing ? "rounded-br-md bg-[#dff4e5] text-[#173c28] dark:bg-[#17452c] dark:text-[#e5f6e9]" : "rounded-bl-md border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"}`}>
                      {!["text", "template"].includes(message.type) && !message.text && <p className="text-xs italic">[{message.type} message]</p>}
                      {message.text && <p className="whitespace-pre-wrap break-words text-xs leading-5">{message.text}</p>}
                      <div className={`mt-1.5 flex items-center justify-end gap-1.5 text-[9px] ${outgoing ? "text-[#52705c] dark:text-[#a7cbb2]" : "text-[var(--muted)]"}`}>
                        {message.status === "failed" && <span title={message.failureMessage}>Failed</span>}
                        {chatTime(message.timestamp)}
                        {outgoing && <MessageStatus status={message.status} />}
                      </div>
                    </div>
                  </div>;
                })}</div>}
              <div ref={messagesEndRef} />
            </div>

            <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
              {hasUncertainSend ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[10px] text-amber-900 dark:text-amber-100">
                <p className="font-semibold">A previous send result is uncertain.</p>
                <p className="mt-1 leading-4">Check WhatsApp before sending again. If you verify the message was not delivered, resolve the hold below.</p>
                <button type="button" onClick={() => void resolveUncertainSend()} className="mt-2 rounded-md border border-current/20 px-2.5 py-1.5 font-semibold">I checked; allow a new send</button>
              </div> : <>
              {!replyWindowOpen && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[10px] text-amber-800 dark:text-amber-200"><span>24-hour reply window closed.</span><button type="button" onClick={() => void loadTemplates()} className="font-semibold underline underline-offset-2">Select an approved template</button></div>}
              {templateMode ? <form onSubmit={(event) => void sendTemplate(event)} className="space-y-2.5">
                <div className="flex items-center justify-between"><p className="text-[11px] font-semibold">Manual template reply</p><button type="button" onClick={() => setTemplateMode(false)} className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-muted)]" aria-label="Close template selector"><X size={14} /></button></div>
                <select value={templateId} onChange={(event) => chooseTemplate(event.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs">
                  <option value="">{templatesLoading ? "Loading approved templates…" : "Choose approved template"}</option>
                  {templates.map((template) => <option key={template._id} value={template._id}>{template.name} · {template.language}</option>)}
                </select>
                {selectedTemplate && <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg bg-[var(--surface-muted)] p-3">
                  <p className="whitespace-pre-wrap text-[10px] leading-4 text-[var(--muted)]">{[selectedTemplate.header, selectedTemplate.body, selectedTemplate.footer].filter(Boolean).join("\n\n")}</p>
                  {selectedTemplate.variables.map((number, index) => <label key={number} className="block text-[10px] font-medium">Value for {`{{${number}}}`}
                    <input value={templateVariables[index] ?? ""} onChange={(event) => setTemplateVariables((values) => values.map((value, valueIndex) => valueIndex === index ? event.target.value : value))} maxLength={1000} className="mt-1 h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs" required />
                  </label>)}
                  {selectedTemplate.buttons.map((button, index) => <span key={index} className="inline-flex rounded-full border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--muted)]">{button.text}</span>)}
                </div>}
                <button type="submit" disabled={!selectedTemplate || sending || templateVariables.some((value) => !value.trim())} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#128c50] px-3 text-xs font-semibold text-white disabled:opacity-50"><Send size={13} />{sending ? "Sending…" : "Send template manually"}</button>
              </form> : <form onSubmit={(event) => void sendText(event)} className="flex items-end gap-2">
                <div className="min-w-0 flex-1"><label htmlFor="inbox-reply" className="sr-only">Type a message</label><textarea id="inbox-reply" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKey} disabled={!replyWindowOpen || sending} rows={2} maxLength={4096} placeholder={replyWindowOpen ? "Type a message… (Enter to send, Shift+Enter for a new line)" : "Free-form replies are unavailable outside the customer service window"} className="max-h-32 min-h-11 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs outline-none focus:border-[var(--accent)] disabled:opacity-60" /></div>
                <button type="submit" disabled={!replyWindowOpen || !draft.trim() || sending} aria-label="Send message" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#128c50] text-white transition hover:bg-[#0f7944] disabled:cursor-not-allowed disabled:opacity-40">{sending ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={15} />}</button>
              </form>}
              <div className="mt-2 text-[9px] text-[var(--muted)]">Manual messages only. WhatsApp delivery statuses are confirmed by webhook.</div>
              </>}
            </div>
            <details className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2 xl:hidden">
              <summary className="cursor-pointer text-[11px] font-semibold">Contact details</summary>
              <div className="py-3">{details}</div>
            </details>
          </> : <div className="m-auto hidden max-w-xs text-center lg:block"><MessageSquareText size={30} className="mx-auto text-[var(--muted)]" /><p className="mt-3 text-sm font-semibold">Your WhatsApp inbox</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Select a conversation to view stored messages and reply manually.</p></div>}
        </main>

        <aside className="hidden min-h-[520px] border-l border-[var(--border)] p-4 xl:block">
          <h3 className="mb-4 text-xs font-semibold">Contact details</h3>
          {details ?? <p className="text-[10px] text-[var(--muted)]">Select a conversation to view details.</p>}
        </aside>
      </section>

      {addContactOpen && selected && <div role="dialog" aria-modal="true" aria-labelledby="add-contact-title" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
        <form onSubmit={(event) => void addContact(event)} className="surface w-full max-w-md rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between"><h3 id="add-contact-title" className="text-sm font-semibold">Add sender to Contacts</h3><button type="button" onClick={() => setAddContactOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)]"><X size={15} /></button></div>
          <p className="mt-1 text-[10px] text-[var(--muted)]">This creates a contact with marketing consent set to Unknown.</p>
          <div className="mt-4 space-y-3">
            <label className="block text-[10px] font-medium">Business name<input required maxLength={160} value={contactBusiness} onChange={(event) => setContactBusiness(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs" /></label>
            <label className="block text-[10px] font-medium">Contact person<input maxLength={120} value={contactPerson} onChange={(event) => setContactPerson(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs" /></label>
            <label className="block text-[10px] font-medium">Category<select required value={contactCategoryId} onChange={(event) => setContactCategoryId(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs"><option value="">Select category</option>{categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}</select></label>
            <label className="block text-[10px] font-medium">City<input maxLength={100} value={contactCity} onChange={(event) => setContactCity(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs" /></label>
          </div>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAddContactOpen(false)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold">Cancel</button><button type="submit" disabled={contactSaving || !contactCategoryId} className="rounded-lg bg-[#128c50] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{contactSaving ? "Adding…" : "Add Contact"}</button></div>
        </form>
      </div>}
    </div>
  );
}
