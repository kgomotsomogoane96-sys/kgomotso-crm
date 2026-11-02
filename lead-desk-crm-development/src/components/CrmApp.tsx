"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Archive, ArrowRight, BarChart3, BookOpen, CalendarClock, CalendarDays, Check,
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Download,
  ExternalLink, FileText, Filter, GripVertical, History, Info, LayoutDashboard, Link2, List,
  Menu, MessageSquare, MonitorSmartphone, Pencil, Plus, RefreshCw, RotateCcw, ScrollText,
  Search, Send, Settings, ShieldCheck, Sparkles, Trash2, Undo2, Upload, User, Wallet, X,
  type LucideIcon,
} from "lucide-react";
import { ActionDialog, EmptyState, Pill, SimpleModal, type DialogSpec, type Field, type PillTone } from "./ui";
import LeadFile from "./LeadFile";
import { AnimatedNumber, Avatar, RevealObserver, Segmented, SmoothScroll, useLenis } from "./motion";
import { ArrowUpRight, Bell, SlidersHorizontal } from "lucide-react";
import type { DueItem, Json, Lead, Stage, Workspace } from "@/lib/types";

type View = "due" | "queue" | "pipeline" | "calendar" | "list" | "library" | "commitments" | "log" | "settings" | "trash" | "contract";
type Filters = { q: string; stage: string; verdict: string; town: string; tag: string; dueWithin: string; sort: string; anyField: string; anyValue: string; archived: string };

const STAGES: Stage[] = ["Sourced", "Demo built", "Sent", "Replied", "Meeting", "Won", "Lost", "Parked"];
const CHANNELS = ["WhatsApp", "Email", "Call", "Walk-in"];
const VERDICTS = ["TRADING", "EXISTS", "UNCERTAIN"];
const PAGE_SIZE = 12;
const DEFAULT_FILTERS: Filters = { q: "", stage: "all", verdict: "all", town: "", tag: "", dueWithin: "all", sort: "next_action", anyField: "", anyValue: "", archived: "false" };

const NAV: { id: View; label: string; icon: LucideIcon; group: string }[] = [
  { id: "due", label: "Due today", icon: Clock3, group: "Workspace" },
  { id: "queue", label: "Send queue", icon: Send, group: "Workspace" },
  { id: "pipeline", label: "Pipeline", icon: BarChart3, group: "Workspace" },
  { id: "calendar", label: "Calendar", icon: CalendarDays, group: "Workspace" },
  { id: "list", label: "All leads", icon: List, group: "Workspace" },
  { id: "library", label: "Library", icon: BookOpen, group: "Records" },
  { id: "commitments", label: "Commitments", icon: RefreshCw, group: "Records" },
  { id: "log", label: "Log & history", icon: ScrollText, group: "Records" },
  { id: "settings", label: "Settings", icon: Settings, group: "System" },
  { id: "trash", label: "Trash & undo", icon: Trash2, group: "System" },
  { id: "contract", label: "Contract & API", icon: ShieldCheck, group: "System" },
];

const VIEW_META: Record<View, { title: string; eyebrow: string; description: string }> = {
  due: { title: "Due today", eyebrow: "First screen", description: "Everything late or due, one row per lead, oldest first. ISO dates only." },
  queue: { title: "Send queue", eyebrow: "Tomorrow", description: "The send order for tomorrow, with times from your windows. You send; the desk records that it went." },
  pipeline: { title: "Pipeline", eyebrow: "Evidence-based", description: "Leads by stage. Stages are not a free-text dropdown; evidence moves them forward." },
  calendar: { title: "Calendar", eyebrow: "Drag to reschedule", description: "Every next action and follow-up on the day it lands. Drag a chip to another day." },
  list: { title: "All leads", eyebrow: "List & bulk", description: "Filter by any field, sort, search, save views and run undoable bulk operations." },
  library: { title: "Library", eyebrow: "Reusable material", description: "Documents, testimonials, wins and message templates. Archive, never destroy." },
  commitments: { title: "Commitments", eyebrow: "My loop", description: "Your own promises with last-run and next-run ISO dates. No watcher, no 07:00 check." },
  log: { title: "Log & history", eyebrow: "Every write is stamped", description: "What happened, who did it, when, and exactly which fields changed." },
  settings: { title: "Settings", eyebrow: "Cadence & guardrails", description: "Cadence days, send windows, daily quota, A/B split and channel order." },
  trash: { title: "Trash & undo", eyebrow: "Nothing is deleted", description: "Soft-deleted records stay in the export. Restore any object or undo the last operation." },
  contract: { title: "Contract & API", eyebrow: "The non-negotiables", description: "The rules this desk enforces, the export/import contract, and what no CRM can give me." },
};

const REALITY = [
  "I do not run on a schedule. I act when you message me. There is no 07:00 check, no watcher on an inbox. If the CRM has a reminder engine, that engine is what wakes you up — not me.",
  "I cannot send from inside your CRM unless it has an API and you give me a key, and even then the first message to a stranger should be a human click. Design for: I draft, you send, the app records that it went.",
  "I cannot log into your account. Anything behind a login is invisible to me. The export and the API key are the only doors.",
  "I cannot see the future state of the file. If two of us edit the same record between turns, the last write wins. Stamped writes and history(record_id) are how we catch that.",
  "One page. If a tool cannot do §6, it cannot hold this desk. If it cannot do §0, do not build in it.",
];

const GUARDRAILS = [
  "No TRADING verdict without non-empty proof and proof_source.",
  "mark_sent is the only way a lead becomes Sent.",
  "mark_sent also generates all three cadence follow-ups and sets next_action.",
  "A reply stops every incomplete nudge; no follow-up can remain due.",
  "Touches are append-only. Corrections are new entries.",
  "Follow-ups are generated from cadence, never typed.",
  "Won requires value_paid and paid_at. Money first, then the win.",
  "A lead with no defects, no message and no date is warned as a bookmark.",
];

const API_FUNCTIONS: [string, string, string][] = [
  ["list_leads", "GET", "filter, sort, page"],
  ["get_lead", "GET", "id → full record and children"],
  ["search", "GET", "q across all lead text"],
  ["due_between", "GET", "from, to → flat due list"],
  ["calendar", "GET", "from, to → grouped by day"],
  ["stats", "GET", "range → header counts"],
  ["export_all", "GET", "full lead-desk/1 dataset"],
  ["create_lead", "POST", "payload → new immutable id"],
  ["update_lead", "POST", "id + partial patch"],
  ["archive_lead / restore_lead", "POST", "soft delete"],
  ["set_verdict", "POST", "proof rule enforced"],
  ["add_contact / update_contact / remove_contact", "POST", "child records"],
  ["add_defect / update_defect / remove_defect", "POST", "child records"],
  ["set_message", "POST", "stores a new version"],
  ["set_next_action", "POST", "text + ISO date"],
  ["complete_next_action", "POST", "closes action, logs touch"],
  ["set_stage", "POST", "validated against evidence"],
  ["attach_demo / attach_screenshot / set_research", "POST", "lead evidence"],
  ["mark_sent", "POST", "the single most important write"],
  ["log_touch", "POST", "append-only contact"],
  ["add_followup / reschedule_followup / complete_followup", "POST", "cadence generated"],
  ["record_reply / close_lead / record_win", "POST", "outcome and money"],
  ["bulk", "POST", "ids + operation + args, one undo step"],
  ["apply_template", "POST", "lead facts fill placeholders"],
  ["duplicate_check", "GET", "name, town, phone"],
  ["documents.list / get / create / update / archive", "GET / POST", "library"],
  ["testimonials.add / update / remove", "POST", "library"],
  ["wins.list / add / remove", "GET / POST", "money landed"],
  ["commitments.list / update", "GET / POST", "last_run, next_run"],
  ["settings.get / update", "GET / POST", "cadence and quota"],
  ["history", "GET", "record_id → field-level changes"],
  ["undo_last", "POST", "reverts an entire operation"],
];

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function stamp(value: unknown): string {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return `${raw.slice(0, 10)} ${raw.slice(11, 16)}`;
  return raw || "—";
}

function money(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? `R ${Math.round(n).toLocaleString("en-ZA")}` : "—";
}

function dateAdd(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function monthGrid(anchor: string, offset: number): { dates: string[]; label: string; first: string } {
  const base = new Date(`${anchor}T00:00:00.000Z`);
  const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
  const firstIso = first.toISOString().slice(0, 10);
  const start = dateAdd(firstIso, -first.getUTCDay());
  return {
    dates: Array.from({ length: 42 }, (_, i) => dateAdd(start, i)),
    label: first.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }),
    first: firstIso,
  };
}

function stageTone(stage: string): PillTone {
  if (stage === "Won") return "green";
  if (stage === "Replied" || stage === "Meeting") return "purple";
  if (stage === "Sent") return "blue";
  if (stage === "Lost") return "red";
  if (stage === "Parked") return "amber";
  return "gray";
}

function verdictTone(verdict: string): PillTone {
  return verdict === "TRADING" ? "green" : verdict === "EXISTS" ? "blue" : "amber";
}

function fieldAt(lead: Lead, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Json)[key] : undefined, lead);
}

function searchableLead(lead: Lead): string {
  return [
    lead.name, lead.town, lead.kind, lead.address, lead.research, lead.url, lead.site_platform,
    ...(lead.tags ?? []).map(String),
    ...(lead.contacts ?? []).flatMap((c) => [c.name, c.role, c.phone, c.whatsapp, c.email]),
    ...(lead.defects ?? []).flatMap((d) => [d.text, d.page]),
    ...(lead.touches ?? []).flatMap((t) => [t.note, t.outcome]),
    lead.message?.subject, lead.message?.body, lead.reply?.text,
  ].map((value) => text(value)).join(" ").toLowerCase();
}

function dueItems(workspace: Workspace, from: string, to: string): DueItem[] {
  const items: DueItem[] = [];
  for (const lead of workspace.leads) {
    if (lead.archived_at) continue;
    if (lead.next_action?.date && lead.next_action.date >= from && lead.next_action.date <= to) {
      const date = lead.next_action.date;
      items.push({ lead_id: lead.id, lead_name: lead.name, town: lead.town, stage: lead.stage, kind: "next_action", item_id: `${lead.id}:next`, text: lead.next_action.text, date, overdue: date < workspace.generated_at.slice(0, 10), days_overdue: Math.max(0, daysBetween(date, workspace.generated_at.slice(0, 10))) });
    }
    if (!lead.reply?.at) {
      for (const f of lead.followups ?? []) {
        if (f.done || f.archived_at || f.stopped_by_reply) continue;
        const date = text(f.due);
        if (date >= from && date <= to) {
          items.push({ lead_id: lead.id, lead_name: lead.name, town: lead.town, stage: lead.stage, kind: "followup", item_id: text(f.id), text: text(f.what), date, overdue: date < workspace.generated_at.slice(0, 10), days_overdue: Math.max(0, daysBetween(date, workspace.generated_at.slice(0, 10))) });
        }
      }
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.lead_name.localeCompare(b.lead_name));
}

function calcStats(workspace: Workspace, range: string) {
  const today = workspace.generated_at.slice(0, 10);
  const from = range === "7d" ? dateAdd(today, -7) : range === "30d" ? dateAdd(today, -30) : "1900-01-01";
  const within = (value: unknown) => {
    const date = text(value).slice(0, 10);
    return date >= from && date <= today;
  };
  const won = workspace.leads.filter((l) => l.stage === "Won" && Number(l.value_paid) > 0 && text(l.paid_at) && within(l.paid_at));
  return {
    due: dueItems(workspace, "1900-01-01", today).length,
    sent: workspace.leads.filter((l) => l.sent?.at && within(l.sent.at)).length,
    replied: workspace.leads.filter((l) => l.reply?.at && within(l.reply.at)).length,
    demos: workspace.leads.filter((l) => text(l.demo?.url)).length,
    won: won.length,
    revenue: won.reduce((sum, l) => sum + Number(l.value_paid ?? 0), 0),
    active: workspace.leads.length,
  };
}

function Panel({ title, description, actions, children, className = "" }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section data-reveal className={`kc-card overflow-hidden ${className}`}>
      <div className="flex flex-col gap-2 border-b border-[rgba(60,60,67,.09)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div><h2 className="text-[15px] font-semibold tracking-[-0.02em]">{title}</h2>{description && <p className="mt-0.5 text-[11.5px] leading-relaxed text-[#8a8e95]">{description}</p>}</div>
        {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function TinyLabel({ children }: { children: ReactNode }) {
  return <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-[#8a8e95]">{children}</div>;
}

export const HREFS: Record<View, string> = {
  due: "/", queue: "/queue", pipeline: "/pipeline", calendar: "/calendar", list: "/leads",
  library: "/library", commitments: "/commitments", log: "/log", settings: "/settings",
  trash: "/trash", contract: "/contract",
};

export default function CrmApp({ initialWorkspace, view }: { initialWorkspace: Workspace; view: View }) {
  return (
    <SmoothScroll>
      <CrmDesk initialWorkspace={initialWorkspace} view={view} />
    </SmoothScroll>
  );
}

function CrmDesk({ initialWorkspace, view }: { initialWorkspace: Workspace; view: View }) {
  const lenis = useLenis();
  const router = useRouter();
  const [dueTab, setDueTab] = useState<"all" | "overdue" | "today">("all");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [actor, setActor] = useState("You");
  const [range, setRange] = useState("30d");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Json[]>([]);
  const [importReport, setImportReport] = useState<Json | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [dragDate, setDragDate] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [libraryTab, setLibraryTab] = useState<"documents" | "testimonials" | "wins" | "templates">("documents");
  const [logTab, setLogTab] = useState<"journal" | "audit" | "history" | "operations">("journal");
  const [logFilter, setLogFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("kc_actor");
    if (saved) setActor(saved);
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const l = lenis.current;
    if (!l) return;
    if (selectedId || dialog || importReport) l.stop();
    else l.start();
  }, [selectedId, dialog, importReport, lenis]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/fn/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const data = await response.json() as { result?: Json[] };
        setSearchResults(Array.isArray(data.result) ? data.result : []);
      } catch {
        setSearchResults([]);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/desk", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not refresh the workspace.");
    setWorkspace(await response.json() as Workspace);
  }, []);

  const run = useCallback(async (name: string, args: Json) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/fn/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args, actor }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; result?: unknown };
      if (!response.ok || data.ok === false) throw new Error(data.error || `${name} failed`);
      await refresh();
      setToast({ kind: "success", message: `${name} stamped by ${actor}` });
      return data;
    } finally {
      setBusy(false);
    }
  }, [actor, refresh]);

  const quick = useCallback((name: string, args: Json) => {
    void run(name, args).catch((error: unknown) => setToast({ kind: "error", message: error instanceof Error ? error.message : "Operation failed" }));
  }, [run]);

  const open = useCallback((title: string, description: string, fields: Field[], onSubmit: (values: Json) => Promise<void> | void, extra: Partial<DialogSpec> = {}) => {
    setDialog({ title, description, fields, onSubmit, ...extra });
  }, []);

  function download(format: "json" | "csv") {
    const link = document.createElement("a");
    link.href = `/api/export${format === "csv" ? "?format=csv" : ""}`;
    link.download = `kgomotsoconversions-export.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setToast({ kind: "success", message: `Full ${format.toUpperCase()} export started — no login required` });
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as Json;
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, actor }) });
      const data = await response.json() as { ok?: boolean; error?: string; result?: Json };
      if (!response.ok || data.ok === false) throw new Error(data.error || "Import failed");
      await refresh();
      setImportReport(data.result ?? {});
      setToast({ kind: "success", message: "Import merged by ID; nothing was replaced wholesale" });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "Import failed" });
    }
  }

  function openNewLead() {
    const today = workspace.generated_at.slice(0, 10);
    open("New lead", "Every record gets an immutable ID and ISO dates. Missing defects, message and date creates a warned bookmark, not a blocked lead.", [
      { name: "name", label: "Business name", required: true, placeholder: "As the business writes it" },
      { name: "town", label: "Town", required: true },
      { name: "kind", label: "Kind", placeholder: "guest house, law firm, panel beater" },
      { name: "address", label: "Address" },
      { name: "url", label: "Website URL", type: "url" },
      { name: "site_platform", label: "Site platform", placeholder: "WordPress, Divi, Wix…" },
      { name: "verdict", label: "Verdict", type: "select", options: VERDICTS.map((v) => ({ value: v, label: v })), defaultValue: "UNCERTAIN", required: true },
      { name: "verified_at", label: "Verified at", type: "date", defaultValue: today },
      { name: "proof", label: "Proof", type: "textarea", span: true, help: "Reviews, listings, published rates. Required for TRADING." },
      { name: "proof_source", label: "Proof source URL", type: "url", span: true, placeholder: "https://…" },
      { name: "channel", label: "Preferred channel", type: "select", options: CHANNELS.map((c) => ({ value: c, label: c })), defaultValue: "WhatsApp", required: true },
      { name: "contact_name", label: "First contact" },
      { name: "phone", label: "Phone / WhatsApp" },
      { name: "email", label: "Email", type: "email" },
      { name: "value_quoted", label: "Value quoted (ZAR)", type: "number" },
      { name: "defect_text", label: "First defect", type: "textarea", span: true, placeholder: "What is wrong with their mobile site?" },
      { name: "defect_page", label: "Defect page", placeholder: "Home" },
      { name: "screenshot", label: "Mobile screenshot URL", type: "url" },
      { name: "message_subject", label: "Message subject", span: true },
      { name: "message_body", label: "Message body", type: "textarea", rows: 5, span: true },
      { name: "next_action_text", label: "Next action", span: true },
      { name: "next_action_date", label: "Next action date", type: "date" },
      { name: "tags", label: "Tags", placeholder: "saturday-batch, walk-in" },
      { name: "research", label: "Research notes", type: "textarea", span: true },
    ], async (v) => {
      const contact = text(v.contact_name) || text(v.phone) || text(v.email);
      await run("create_lead", {
        name: v.name, town: v.town, kind: v.kind, address: v.address, url: v.url,
        site_platform: v.site_platform, verdict: v.verdict, proof: v.proof,
        proof_source: v.proof_source, verified_at: v.verified_at || undefined,
        channel: v.channel, screenshot: v.screenshot || undefined,
        screenshot_captured_at: v.screenshot ? new Date().toISOString() : undefined,
        value_quoted: v.value_quoted || undefined,
        contacts: contact ? [{ name: text(v.contact_name) || "Unnamed contact", phone: text(v.phone), whatsapp: text(v.phone), email: text(v.email), is_owner: true }] : [],
        defects: text(v.defect_text) ? [{ text: v.defect_text, page: v.defect_page }] : [],
        message: text(v.message_body) ? { subject: text(v.message_subject) || `A quicker mobile page for ${text(v.name)}`, body: v.message_body, channel: v.channel } : null,
        next_action: text(v.next_action_date) ? { text: text(v.next_action_text) || "Follow up", date: v.next_action_date } : null,
        tags: text(v.tags).split(",").map((tag) => tag.trim()).filter(Boolean),
        research: v.research, phone: v.phone,
      });
    }, {
      submitLabel: "Create stable lead",
      notice: (v) => {
        const notes: string[] = [];
        const name = text(v.name).toLowerCase();
        const town = text(v.town).toLowerCase();
        const phone = text(v.phone).replace(/\D/g, "");
        const duplicate = workspace.leads.find((l) => (text(l.name).toLowerCase() === name && text(l.town).toLowerCase() === town && name) || (phone.length > 5 && (l.contacts ?? []).some((c) => text(c.phone).replace(/\D/g, "").endsWith(phone))));
        if (duplicate) notes.push(`Possible duplicate: ${duplicate.id}. duplicate_check will report it.`);
        if (!text(v.defect_text) && !text(v.message_body) && !text(v.next_action_date)) notes.push("Bookmark only: no defects, no message and no next-action date.");
        if (v.verdict === "TRADING" && (!text(v.proof) || !text(v.proof_source))) notes.push("TRADING will be refused without proof and proof_source.");
        return notes.length ? notes.join(" · ") : null;
      },
    });
  }

  function openBulk() {
    if (!selectedIds.length) return;
    const today = workspace.generated_at.slice(0, 10);
    open("Bulk operation", `${selectedIds.length} selected records. Each record is atomic; the whole batch is one undo step.`, [
      { name: "operation", label: "Operation", type: "select", required: true, span: true, defaultValue: "archive_lead", options: [
        { value: "archive_lead", label: "Archive leads" }, { value: "restore_lead", label: "Restore leads" },
        { value: "set_verdict", label: "Set verdict with proof" }, { value: "add_defect", label: "Add defect" },
        { value: "set_next_action", label: "Set next action" }, { value: "log_touch", label: "Log touch" },
        { value: "set_research", label: "Set research" }, { value: "update_lead", label: "Update tags / fields" },
      ] },
      { name: "verdict", label: "Verdict (set_verdict)", type: "select", options: VERDICTS.map((v) => ({ value: v, label: v })), defaultValue: "EXISTS" },
      { name: "proof", label: "Proof (set_verdict)" },
      { name: "proof_source", label: "Proof source URL (set_verdict)", type: "url" },
      { name: "defect_text", label: "Defect text (add_defect)", type: "textarea", span: true },
      { name: "page", label: "Defect page" },
      { name: "next_text", label: "Next action text" },
      { name: "date", label: "ISO date", type: "date", defaultValue: today },
      { name: "channel", label: "Channel", type: "select", options: CHANNELS.map((c) => ({ value: c, label: c })), defaultValue: "WhatsApp" },
      { name: "direction", label: "Direction", type: "select", options: [{ value: "outbound", label: "Outbound" }, { value: "inbound", label: "Inbound" }], defaultValue: "outbound" },
      { name: "outcome", label: "Touch outcome", defaultValue: "Bulk contact logged" },
      { name: "note", label: "Touch note" },
      { name: "research", label: "Research (set_research)", type: "textarea", span: true },
      { name: "tags", label: "Tags (update_lead)", placeholder: "comma, separated" },
    ], async (v) => {
      const operation = text(v.operation);
      const args: Json = {};
      if (operation === "set_verdict") Object.assign(args, { verdict: v.verdict, proof: v.proof, proof_source: v.proof_source, verified_at: today });
      if (operation === "add_defect") Object.assign(args, { text: v.defect_text, page: v.page || "Site" });
      if (operation === "set_next_action") Object.assign(args, { text: v.next_text || "Follow up", date: v.date || today });
      if (operation === "log_touch") Object.assign(args, { channel: v.channel, direction: v.direction, outcome: v.outcome || "Bulk contact logged", note: v.note });
      if (operation === "set_research") args.text = v.research;
      if (operation === "update_lead") args.patch = { tags: text(v.tags).split(",").map((t) => t.trim()).filter(Boolean) };
      await run("bulk", { ids: selectedIds, operation, args });
      setSelectedIds([]);
    }, { submitLabel: "Run bulk write" });
  }

  function openDocumentForm(item?: Json) {
    open(item ? "Edit document" : "New document", "Documents are versioned and soft-deleted; every update is stamped.", [
      { name: "kind", label: "Kind", type: "select", options: ["brand", "operating", "build"].map((k) => ({ value: k, label: k })), defaultValue: text(item?.kind) || "operating", required: true },
      { name: "version", label: "Version", type: "number", defaultValue: Number(item?.version ?? 1), required: true },
      { name: "title", label: "Title", defaultValue: text(item?.title), required: true, span: true },
      { name: "body", label: "Body", type: "textarea", rows: 7, defaultValue: text(item?.body), span: true },
    ], async (v) => {
      if (item) await run("documents_update", { id: item.id, patch: v });
      else await run("documents_create", v);
    });
  }

  function openTestimonialForm(item?: Json) {
    open(item ? "Edit testimonial" : "Add testimonial", "Permission is explicit. Dates are ISO.", [
      { name: "quote", label: "Quote", type: "textarea", rows: 5, defaultValue: text(item?.quote), required: true, span: true },
      { name: "who", label: "Who", defaultValue: text(item?.who) },
      { name: "business", label: "Business", defaultValue: text(item?.business) },
      { name: "date", label: "Date", type: "date", defaultValue: text(item?.date) || workspace.generated_at.slice(0, 10), required: true },
      { name: "permission_given", label: "Permission given", type: "checkbox", defaultValue: Boolean(item?.permission_given) },
    ], async (v) => {
      if (item) await run("testimonials_update", { id: item.id, patch: v });
      else await run("testimonials_add", v);
    });
  }

  function openWinForm() {
    open("Record a win", "Use this only when money landed. It creates a Win and sets value_paid / paid_at on the lead.", [
      { name: "lead_id", label: "Lead", type: "select", options: workspace.leads.map((l) => ({ value: l.id, label: `${l.name} · ${l.id}` })), required: true, span: true },
      { name: "what", label: "What was paid for", required: true, span: true },
      { name: "amount", label: "Amount received (ZAR)", type: "number", required: true },
      { name: "date", label: "Payment date", type: "date", defaultValue: workspace.generated_at.slice(0, 10), required: true },
    ], async (v) => { await run("wins_add", { id: v.lead_id, ...v }); });
  }

  function openTemplateForm(item?: Json) {
    open(item ? "Edit template" : "New template", "Use {name}, {town}, {kind}, {url}, {contact} and {defect}.", [
      { name: "name", label: "Template name", defaultValue: text(item?.name), required: true },
      { name: "channel", label: "Channel", type: "select", options: CHANNELS.map((c) => ({ value: c, label: c })), defaultValue: text(item?.channel) || "WhatsApp", required: true },
      { name: "subject", label: "Subject", defaultValue: text(item?.subject), required: true, span: true },
      { name: "body", label: "Body", type: "textarea", rows: 6, defaultValue: text(item?.body), required: true, span: true },
    ], async (v) => {
      if (item) await run("update_template", { id: item.id, patch: v });
      else await run("create_template", v);
    });
  }

  function openCommitmentForm(item?: Json) {
    const today = workspace.generated_at.slice(0, 10);
    open(item ? "Update commitment" : "New commitment", "Your own loop. Last-run and next-run dates are stored in ISO.", [
      { name: "task", label: "Task", defaultValue: text(item?.task), required: true, span: true },
      { name: "what", label: "What it means", type: "textarea", defaultValue: text(item?.what), span: true },
      { name: "cadence", label: "Cadence", defaultValue: text(item?.cadence) || "When prompted" },
      { name: "owner", label: "Owner", defaultValue: text(item?.owner) || actor },
      { name: "last_run", label: "Last run", type: "date", defaultValue: text(item?.last_run) || today },
      { name: "next_run", label: "Next run", type: "date", defaultValue: text(item?.next_run) || today, required: true },
    ], async (v) => {
      if (item) await run("commitments_update", { id: item.id, patch: v });
      else await run("commitments_add", v);
    });
  }

  function openSettingsForm() {
    open("Update settings", "Three cadence days generate the three follow-ups at mark_sent. Times are HH:mm.", [
      { name: "cadence_days", label: "Cadence days", defaultValue: (workspace.settings.cadence_days ?? []).join(", "), required: true, help: "Exactly three positive numbers, e.g. 2, 5, 9" },
      { name: "send_windows", label: "Send windows", defaultValue: (workspace.settings.send_windows ?? []).join(", "), required: true, help: "HH:mm, comma separated" },
      { name: "daily_quota", label: "Daily quota", type: "number", defaultValue: workspace.settings.daily_quota, required: true },
      { name: "ab_split", label: "A/B split (%)", type: "number", defaultValue: workspace.settings.ab_split, required: true },
      { name: "channel_order", label: "Channel order", defaultValue: (workspace.settings.channel_order ?? []).join(", "), span: true },
      { name: "timezone_label", label: "Timezone label", defaultValue: text(workspace.settings.timezone_label), span: true },
    ], async (v) => { await run("settings_update", { patch: v }); }, { submitLabel: "Save settings" });
  }

  function openSavedViewForm() {
    open("Save current view", "The filter object is stored with its own stable ID.", [
      { name: "name", label: "View name", required: true, span: true },
    ], async (v) => {
      const filter: Json = {};
      for (const [key, value] of Object.entries(filters)) if (value && value !== "all" && key !== "q") filter[key] = value;
      await run("create_saved_view", { name: v.name, filter });
    });
  }

  const today = workspace.generated_at.slice(0, 10);
  const tomorrow = dateAdd(today, 1);
  const stats = useMemo(() => calcStats(workspace, range), [workspace, range]);
  const dueToday = useMemo(() => dueItems(workspace, "1900-01-01", today), [workspace, today]);
  const allDue = useMemo(() => dueItems(workspace, "1900-01-01", "2099-12-31"), [workspace]);
  const queue = useMemo(() => workspace.leads
    .filter((l) => !l.archived_at && !l.sent?.at && l.message && ["Sourced", "Demo built"].includes(l.stage))
    .sort((a, b) => (a.next_action?.date ?? "9999-12-31").localeCompare(b.next_action?.date ?? "9999-12-31") || a.town.localeCompare(b.town) || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Number(workspace.settings.daily_quota ?? 12))), [workspace]);
  const allLeads = useMemo(() => workspace.records.filter((r) => r.type === "lead").map((r) => ({ ...(r.data as unknown as Lead), archived_at: r.archived_at })), [workspace]);
  const filteredLeads = useMemo(() => {
    let rows = allLeads.filter((lead) => {
      if (filters.archived === "false" && lead.archived_at) return false;
      if (filters.archived === "true" && !lead.archived_at) return false;
      if (text(filters.q) && !searchableLead(lead).includes(text(filters.q).toLowerCase())) return false;
      if (filters.stage !== "all" && lead.stage !== filters.stage) return false;
      if (filters.verdict !== "all" && lead.verdict !== filters.verdict) return false;
      if (text(filters.town) && !text(lead.town).toLowerCase().includes(text(filters.town).toLowerCase())) return false;
      if (text(filters.tag) && !(lead.tags ?? []).map(String).some((tag) => tag.toLowerCase().includes(text(filters.tag).toLowerCase()))) return false;
      if (filters.dueWithin !== "all" && (!lead.next_action?.date || daysBetween(today, lead.next_action.date) > Number(filters.dueWithin))) return false;
      if (text(filters.anyField) && text(filters.anyValue) && !text(fieldAt(lead, filters.anyField)).toLowerCase().includes(text(filters.anyValue).toLowerCase())) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (filters.sort === "name") return a.name.localeCompare(b.name);
      if (filters.sort === "verdict") return a.verdict.localeCompare(b.verdict);
      if (filters.sort === "defects") return (b.defects ?? []).filter((d) => !d.archived_at).length - (a.defects ?? []).filter((d) => !d.archived_at).length;
      if (filters.sort === "stage") return STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage);
      if (filters.sort === "updated_at") return text(b.updated_at).localeCompare(text(a.updated_at));
      return (a.next_action?.date ?? "9999-12-31").localeCompare(b.next_action?.date ?? "9999-12-31");
    });
    return rows;
  }, [allLeads, filters, today]);
  const visibleLeads = filteredLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const month = useMemo(() => monthGrid(today, monthOffset), [today, monthOffset]);
  const dueByDate = useMemo(() => {
    const map: Record<string, DueItem[]> = {};
    for (const item of allDue) (map[item.date] ??= []).push(item);
    return map;
  }, [allDue]);
  const activeLead = workspace.leads.find((lead) => lead.id === selectedId) ?? null;
  const trashedLeadRow = workspace.trash.find((row) => row.type === "lead" && row.id === selectedId);
  const selectedLead = activeLead ?? (trashedLeadRow ? { ...(trashedLeadRow.data as unknown as Lead), archived_at: trashedLeadRow.archived_at } : null);

  function go(nextView: View) {
    if (HREFS[nextView] === window.location.pathname) return;
    router.push(HREFS[nextView]);
  }

  function openLead(id: string) {
    router.push(`/leads/${id}`);
  }

  function renderHero() {
    const overdue = dueToday.filter((d) => d.overdue);
    const nextWeek = dueItems(workspace, tomorrow, dateAdd(today, 7));
    const sentLeads = workspace.leads.filter((l) => l.sent?.at);
    const repliedLeads = workspace.leads.filter((l) => l.reply?.at);
    const demoLeads = workspace.leads.filter((l) => text(l.demo?.url));
    const wonLeads = workspace.leads.filter((l) => l.stage === "Won" && Number(l.value_paid) > 0);
    const replyGaps = workspace.leads.filter((l) => l.sent?.at && l.reply?.at).map((l) => Math.max(0, (Date.parse(text(l.reply?.at)) - Date.parse(text(l.sent?.at))) / 86_400_000));
    const replyDays = replyGaps.length ? replyGaps.reduce((a, b) => a + b, 0) / replyGaps.length : 0;
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
    const bars = [
      { label: "Reply rate", sub: `${repliedLeads.length}/${sentLeads.length} sent`, pct: pct(repliedLeads.length, sentLeads.length), leads: repliedLeads },
      { label: "Demo coverage", sub: `${demoLeads.length}/${workspace.leads.length} leads`, pct: pct(demoLeads.length, workspace.leads.length), leads: demoLeads },
      { label: "Close rate", sub: `${wonLeads.length}/${repliedLeads.length} replied`, pct: pct(wonLeads.length, repliedLeads.length), leads: wonLeads },
    ];
    const quoted = workspace.leads.filter((l) => l.stage !== "Lost" && !l.value_paid).reduce((sum, l) => sum + Number(l.value_quoted ?? 0), 0);
    const channels = (["WhatsApp", "Email", "Call"] as const).map((c) => ({ c, n: sentLeads.filter((l) => l.sent?.channel === c).length }));
    const top = channels.reduce((a, b) => (b.n > a.n ? b : a), channels[0]);
    const metric = (label: string, value: number, unit: string, decimals = 0) => (
      <div>
        <div className="text-[12.5px] text-[#6b6f76]">{label}</div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-[36px] font-normal leading-none tracking-[-0.05em]"><AnimatedNumber value={value} format={(n) => n.toFixed(decimals)} /></span>
          <span className="text-[14px] text-[#8a8e95]">{unit}</span>
        </div>
      </div>
    );
    return (
      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div data-reveal className="kc-card p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {metric("Overdue", overdue.length, overdue.length === 1 ? "item" : "items")}
            {metric("Due within next 7 days", nextWeek.length, "items")}
            {metric("Average time to reply", replyDays, "days", 1)}
          </div>
          <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {bars.map((bar) => (
              <div key={bar.label}>
                <div className="mb-2 flex justify-between text-[11.5px] text-[#6b6f76]"><span>{bar.label}</span><span className="kc-mono">{bar.pct}%</span></div>
                <div className="kc-bar"><div className="kc-bar-fill" style={{ width: `${Math.max(4, bar.pct)}%` }} /></div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="kc-avatar-stack">
                    {bar.leads.slice(0, 5).map((l) => <button key={l.id} onClick={() => openLead(l.id)} title={l.name}><Avatar name={l.name} size={30} /></button>)}
                    {!bar.leads.length && <span className="text-[11px] text-[#a0a4ab]">No leads yet</span>}
                  </div>
                  <span className="text-[10.5px] text-[#8a8e95]">{bar.sub}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div data-reveal style={{ "--d": "90ms" } as CSSProperties} className="kc-card flex flex-col p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12.5px] text-[#6b6f76]">Money landed · {range === "all" ? "all time" : `last ${range === "7d" ? "7" : "30"} days`}</div>
              <div className="mt-2 flex flex-wrap items-baseline gap-2">
                <span className="text-[15px] text-[#6b6f76]">R</span>
                <span className="text-[36px] font-normal leading-none tracking-[-0.05em]"><AnimatedNumber value={stats.revenue} /></span>
                <span className="kc-pill kc-pill-gray">Quoted R {Math.round(quoted).toLocaleString("en-ZA")}</span>
              </div>
            </div>
            <button className="kc-round" title="Open wins" onClick={() => { setLibraryTab("wins"); go("library"); }}><ArrowUpRight size={16} /></button>
          </div>
          <div className="mt-auto grid grid-cols-3 items-end gap-2 pt-6 sm:grid-cols-[1fr_1fr_1fr_auto]">
            {channels.map((ch) => {
              const active = ch.c === top.c && ch.n > 0;
              return (
                <div key={ch.c} className={`flex flex-col justify-between rounded-[20px] p-3 transition-all duration-700 ${active ? "min-h-[108px] bg-[#d8f65a] text-[#111] shadow-[0_14px_30px_-16px_rgba(150,190,20,.9)]" : "min-h-[86px] bg-white/65 text-[#2a2d33]"}`}>
                  <span className="kc-mono text-[12px] font-semibold">#{String(ch.n).padStart(2, "0")} sent</span>
                  <span className="text-[11px] opacity-70">{ch.c}</span>
                </div>
              );
            })}
            <button className="kc-btn kc-btn-dark col-span-3 !min-h-[46px] sm:col-span-1" onClick={() => download("json")}><Download size={13} /> Export</button>
          </div>
        </div>
      </div>
    );
  }

  function renderDue() {
    const byLead = new Map<string, DueItem>();
    for (const item of dueToday) {
      const previous = byLead.get(item.lead_id);
      if (!previous || item.date < previous.date) byLead.set(item.lead_id, item);
    }
    const rows = Array.from(byLead.values()).sort((a, b) => a.date.localeCompare(b.date) || a.lead_name.localeCompare(b.lead_name));
    const overdueRows = rows.filter((r) => r.overdue);
    const todayRows = rows.filter((r) => !r.overdue);
    const shown = dueTab === "overdue" ? overdueRows : dueTab === "today" ? todayRows : rows;
    const current = shown.find((r) => r.lead_id === focusId) ?? shown[0] ?? null;
    const lead = current ? workspace.leads.find((l) => l.id === current.lead_id) ?? null : null;
    const liveContacts = lead ? (lead.contacts ?? []).filter((c) => !c.archived_at) : [];
    const owner = liveContacts.find((c) => c.is_owner) ?? liveContacts[0];
    const defects = lead ? (lead.defects ?? []).filter((d) => !d.archived_at) : [];
    const openFollowups = lead ? (lead.followups ?? []).filter((f) => !f.done && !f.stopped_by_reply) : [];
    const complete = () => {
      if (!current) return;
      if (current.kind === "followup") quick("complete_followup", { id: current.lead_id, followup_id: current.item_id, note: "Completed from Due today" });
      else quick("complete_next_action", { id: current.lead_id, note: "Completed from Due today" });
    };
    const detailCard = (value: ReactNode, label: string, onClick: () => void, key: string) => (
      <button key={key} onClick={onClick} className="kc-detail-card group flex min-h-[112px] flex-col justify-between p-3.5 text-left">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[19px] font-medium tracking-[-0.03em]">{value}</span>
          <ArrowUpRight size={15} className="shrink-0 opacity-60 transition-transform duration-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>
        <span className="line-clamp-2 text-[11.5px] leading-snug opacity-70">{label}</span>
      </button>
    );
    return (
      <div className="space-y-6">
        <section data-reveal className="kc-dark relative mt-8 rounded-[36px] p-3 sm:p-4">
          <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2">
            <Segmented variant="notch" value={dueTab} onChange={(id) => { setDueTab(id as typeof dueTab); setFocusId(null); }} items={[
              { id: "all", label: "All due", count: rows.length },
              { id: "overdue", label: "Overdue", count: overdueRows.length },
              { id: "today", label: "Today", count: todayRows.length },
            ]} />
          </div>
          <div className="flex items-center justify-between gap-3 px-3 pb-4 pt-9 sm:pt-3">
            <h2 className="text-[15px] font-medium text-white/90">Due today <span className="kc-mono ml-1 text-white/40">{today}</span></h2>
            <div className="flex gap-2">
              <button className="kc-btn kc-btn-onDark kc-icon-btn" title="Send queue" onClick={() => go("queue")}><Send size={14} /></button>
              <button className="kc-btn kc-btn-onDark kc-icon-btn" title="Calendar" onClick={() => go("calendar")}><CalendarDays size={14} /></button>
            </div>
          </div>
          {!shown.length || !lead || !current ? (
            <EmptyState dark icon={<CheckCircle2 size={22} />} title="Nothing here" description="Every next action and follow-up in this filter is clear. New cadence items appear when a message is marked sent." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
              <div key={dueTab} className="kc-scroll space-y-1.5 lg:max-h-[540px] lg:overflow-y-auto lg:pr-1">
                {shown.map((item, i) => {
                  const rowLead = workspace.leads.find((l) => l.id === item.lead_id);
                  const active = item.lead_id === current.lead_id;
                  return (
                    <button key={item.lead_id} onClick={() => setFocusId(item.lead_id)} className={`kc-due-row ${active ? "is-active" : ""}`} style={{ "--i": i } as CSSProperties}>
                      <Avatar name={item.lead_name} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{item.lead_name}</div>
                        <div className="kc-due-sub mt-0.5 truncate text-[11px]">{item.overdue ? `${item.days_overdue} days late` : "Due today"} · {item.town}</div>
                      </div>
                      <span className="kc-due-pill hidden sm:inline">{item.kind === "followup" ? "Nudge" : rowLead?.sent ? "Action" : "Unsent"}</span>
                      <span className="w-[76px] text-right text-[14px] font-medium tracking-[-0.02em]"><span className="kc-due-sub mr-0.5 text-[10px]">R</span>{rowLead?.value_quoted ? Number(rowLead.value_quoted).toLocaleString("en-ZA") : "—"}</span>
                    </button>
                  );
                })}
              </div>
              <div key={`${lead.id}-${dueTab}`} className="kc-detail kc-detail-in rounded-[30px] p-4 sm:p-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="min-w-0">
                    <div className="text-[11.5px] opacity-60">Lead details</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="truncate text-[24px] font-normal tracking-[-0.04em]"><span className="text-[15px] opacity-60"># </span>{lead.id.replace(/^lead_/, "")}</span>
                      <span className="rounded-full bg-white/75 px-2.5 py-1 text-[10.5px] font-semibold">{lead.stage}</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11.5px] opacity-60">Company</div>
                    <div className="mt-1 truncate text-[20px] font-semibold tracking-[-0.03em]">{lead.name}</div>
                    <div className="truncate text-[11px] opacity-60">{lead.kind || "Business"} · {lead.town}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11.5px] opacity-60">Contact</div>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <Avatar name={text(owner?.name) || lead.name} size={34} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold">{text(owner?.name) || "No contact"}</div>
                        <div className="truncate text-[11px] opacity-60">{[text(owner?.role), text(owner?.phone)].filter(Boolean).join(" · ") || lead.channel}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 rounded-[20px] bg-[#0f171f]/[.07] px-4 py-3 text-[13px]">
                  <span className="opacity-60">{current.kind === "followup" ? "Cadence nudge" : "Next action"} · <span className="kc-mono">{current.date}</span>{current.overdue ? ` · ${current.days_overdue}d late` : ""}</span>
                  <div className="mt-0.5 font-medium">{current.text}</div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {detailCard(<>{defects.length} <span className="text-[12px] opacity-60">defects</span></>, text(defects[0]?.text) || "No defects recorded", () => openLead(lead.id), "def")}
                  {detailCard(lead.message ? <>v{lead.message.version} <span className="text-[12px] opacity-60">{lead.message.words}w</span></> : "—", lead.message ? lead.message.subject : "No message drafted", () => openLead(lead.id), "msg")}
                  {detailCard(<>{openFollowups.length} <span className="text-[12px] opacity-60">open</span></>, openFollowups[0] ? `Next nudge ${text(openFollowups[0].due)}` : lead.reply ? "Reply stopped the nudges" : "Created by mark_sent", () => openLead(lead.id), "fup")}
                  <button onClick={() => open("Add defect", "A defect is the observed reason for outreach.", [
                    { name: "text", label: "What is wrong?", type: "textarea", required: true, span: true },
                    { name: "page", label: "Page", placeholder: "Home" },
                  ], async (v) => { await run("add_defect", { id: lead.id, ...v }); })} className="kc-detail-card kc-stripes group grid min-h-[112px] place-items-center" title="Add defect">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white/50 transition-transform duration-500 group-hover:rotate-90"><Plus size={18} /></span>
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-3 rounded-[22px] bg-white/30 p-3 sm:flex-row sm:items-center">
                  <div className="grid flex-1 grid-cols-3 gap-3 px-2">
                    <div><div className="text-[10.5px] opacity-60">Quoted</div><div className="text-[17px] font-medium tracking-[-0.03em]">{money(lead.value_quoted)}</div></div>
                    <div><div className="text-[10.5px] opacity-60">Paid</div><div className="text-[17px] font-medium tracking-[-0.03em]">{money(lead.value_paid)}</div></div>
                    <div><div className="text-[10.5px] opacity-60">Verdict</div><div className="text-[14px] font-semibold">{lead.verdict}</div></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="kc-round !bg-white/60" title="Open lead file" onClick={() => openLead(lead.id)}><Pencil size={15} /></button>
                    {lead.message && !lead.sent?.at && <button className="kc-btn kc-btn-dark !min-h-[40px]" onClick={() => quick("mark_sent", { id: lead.id, channel: lead.message?.channel ?? lead.channel })}><Send size={13} /> Mark sent</button>}
                    <button className="kc-btn kc-btn-primary !min-h-[40px]" onClick={complete}><Check size={14} /> Done</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <Panel title="Tomorrow's queue" description={`${tomorrow} · ${(workspace.settings.send_windows ?? []).join(", ")}`} actions={<button className="kc-btn kc-btn-ghost !min-h-[31px] !px-2 !text-[11.5px]" onClick={() => go("queue")}>Open <ChevronRight size={13} /></button>}>
            <div className="divide-y divide-black/5">
              {queue.slice(0, 4).map((l, i) => <button key={l.id} onClick={() => openLead(l.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors duration-300 hover:bg-white/50"><Avatar name={l.name} size={28} /><div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-semibold">{l.name}</div><div className="kc-mono mt-0.5 text-[10px] text-[#8a8e95]">{tomorrow} {(workspace.settings.send_windows ?? [])[i % Math.max(1, (workspace.settings.send_windows ?? []).length)]}</div></div><ChevronRight size={14} className="shrink-0 text-[#a0a4ab]" /></button>)}
              {!queue.length && <p className="px-5 py-6 text-[12px] text-[#8a8e95]">No unsent drafts in the queue.</p>}
            </div>
          </Panel>
          <Panel title="No reminder engine" description="This desk does not wake anyone up."><div className="p-5 text-[12.5px] leading-relaxed text-[#4a4e55]"><p>There is no 07:00 check and no watcher on an inbox. Due today is a query, not a notification service.</p><p className="mt-3">You draft, you click send, and <strong>mark_sent</strong> records that it went.</p></div></Panel>
          <Panel title="Write safety" description="The five non-negotiables are active."><div className="space-y-2.5 p-5 text-[12px] text-[#4a4e55]">{["Stable IDs on every record", "ISO dates and timestamps", "One-click export, no login", "Archive + trash + undo", "Who / when / what on every write"].map((rule) => <div key={rule} className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#d8f65a]"><Check size={11} /></span>{rule}</div>)}</div></Panel>
        </div>
      </div>
    );
  }

  function renderQueue() {
    const windows = workspace.settings.send_windows?.length ? workspace.settings.send_windows : ["08:30", "11:30", "14:30"];
    return (
      <div className="space-y-5">
        <Panel title={`Send order for ${tomorrow}`} description={`${queue.length} of ${Number(workspace.settings.daily_quota ?? 12)} daily quota slots · A/B split ${workspace.settings.ab_split}% · channel order ${(workspace.settings.channel_order ?? []).join(" → ")}`} actions={<Pill tone="amber">Human click required</Pill>}>
          <div className="kc-scroll overflow-x-auto"><table className="kc-table min-w-[980px]"><thead><tr><th>#</th><th>Window</th><th>Lead</th><th>Proof</th><th>Message</th><th>Arm</th><th className="text-right">Record it went</th></tr></thead><tbody>
            {queue.map((lead, index) => {
              const time = windows[index % windows.length];
              const channel = (workspace.settings.channel_order ?? [lead.channel])[0] ?? lead.channel;
              const arm = index % 100 < Number(workspace.settings.ab_split ?? 50) ? "A" : "B";
              return <tr key={lead.id}>
                <td className="kc-mono text-[#8a8e95]">{String(index + 1).padStart(2, "0")}</td>
                <td><div className="kc-mono font-semibold text-[#1f1f21]">{tomorrow} {time}</div><div className="mt-1 text-[10.5px] text-[#8a8e95]">{channel}</div></td>
                <td><button className="text-left font-semibold hover:text-[#1f1f21]" onClick={() => openLead(lead.id)}>{lead.name}</button><div className="mt-0.5 text-[11px] text-[#8a8e95]">{lead.town} · {lead.kind}</div><div className="kc-mono mt-0.5 text-[10px] text-[#a1a1a6]">{lead.id}</div></td>
                <td><Pill tone={verdictTone(lead.verdict)}>{lead.verdict}</Pill><div className="mt-1 max-w-[190px] truncate text-[11px] text-[#8a8e95]">{text(lead.proof)}</div></td>
                <td className="max-w-[260px]"><div className="truncate text-[12.5px] font-medium">{lead.message?.subject}</div><div className="mt-1 text-[11px] text-[#8a8e95]">v{lead.message?.version} · {lead.message?.words} words · {lead.message?.channel}</div></td>
                <td><Pill tone={arm === "A" ? "blue" : "purple"}>{arm}</Pill></td>
                <td><div className="flex justify-end gap-1.5"><button className="kc-btn kc-btn-secondary !min-h-[32px] !px-3 !text-[11.5px]" onClick={() => openLead(lead.id)}>Open</button><button className="kc-btn kc-btn-primary !min-h-[32px] !px-3 !text-[11.5px]" onClick={() => quick("mark_sent", { id: lead.id, channel })}><Send size={12} /> Mark sent</button></div></td>
              </tr>;
            })}
            {!queue.length && <tr><td colSpan={7} className="py-12 text-center text-[#8a8e95]">No leads with a draft are waiting to be sent.</td></tr>}
          </tbody></table></div>
        </Panel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Panel title="What mark_sent does" description="One call. No silent cadence break."><div className="grid gap-2 p-5 text-[12.5px] text-[#515154] sm:grid-cols-2"><div className="flex gap-2"><Check size={15} className="text-[#248a3d]" /> Stamps sent.at / channel / by</div><div className="flex gap-2"><Check size={15} className="text-[#248a3d]" /> Appends an outbound touch</div><div className="flex gap-2"><Check size={15} className="text-[#248a3d]" /> Generates three follow-ups</div><div className="flex gap-2"><Check size={15} className="text-[#248a3d]" /> Sets the next action</div><div className="flex gap-2"><Check size={15} className="text-[#248a3d]" /> Moves stage to Sent</div><div className="flex gap-2"><Check size={15} className="text-[#248a3d]" /> Assigns the A/B arm</div></div></Panel>
          <Panel title="No automatic sending" description="The first message to a stranger stays human."><div className="p-5 text-[12.5px] leading-relaxed text-[#515154]">The CRM never sends from inside itself. The window is a planning time, not a scheduler. When you actually send, click <strong>Mark sent</strong>; the app records the real timestamp and stamps who did it.</div></Panel>
        </div>
      </div>
    );
  }

  function renderPipeline() {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-2 rounded-2xl border border-[rgba(170,210,30,.15)] bg-[rgba(170,210,30,.06)] px-4 py-3 text-[12px] leading-relaxed text-[#3b4700]"><Info size={15} className="mt-0.5 shrink-0" /> Sourced → Demo built → Sent → Replied → Meeting → Won, plus Lost and Parked. Sent needs mark_sent, Replied needs record_reply, and Won needs money. Use the lead file for evidence-based transitions.</div>
        <div className="kc-scroll flex gap-4 overflow-x-auto pb-3">
          {STAGES.map((stage) => {
            const leads = workspace.leads.filter((l) => l.stage === stage);
            return <div key={stage} className="w-[260px] shrink-0 rounded-[22px] border border-[rgba(60,60,67,.10)] bg-white/45 p-3">
              <div className="mb-3 flex items-center justify-between px-1"><div className="flex items-center gap-2"><Pill tone={stageTone(stage)}>{stage}</Pill></div><span className="kc-mono text-[11px] text-[#8a8e95]">{leads.length}</span></div>
              <div className="space-y-2.5">
                {leads.map((lead) => <button key={lead.id} onClick={() => openLead(lead.id)} className="kc-card-flat block w-full p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(16,24,40,.09)]">
                  <div className="truncate text-[13px] font-semibold">{lead.name}</div><div className="mt-1 text-[11px] text-[#8a8e95]">{lead.town} · {lead.kind}</div>
                  <div className="mt-3 flex flex-wrap gap-1.5"><Pill tone={verdictTone(lead.verdict)}>{lead.verdict}</Pill>{lead.demo?.url && <Pill tone="blue">Demo</Pill>}{lead.value_paid ? <Pill tone="green">{money(lead.value_paid)}</Pill> : null}</div>
                  {lead.next_action && <div className="kc-mono mt-3 border-t border-[rgba(60,60,67,.08)] pt-2.5 text-[10px] text-[#6b6f76]">{lead.next_action.date} · {text(lead.next_action.text).slice(0, 38)}</div>}
                </button>)}
                {!leads.length && <div className="rounded-xl border border-dashed border-[rgba(60,60,67,.16)] px-3 py-7 text-center text-[11px] text-[#a1a1a6]">No leads</div>}
              </div>
            </div>;
          })}
        </div>
      </div>
    );
  }

  async function dropOnDate(event: React.DragEvent<HTMLDivElement>, date: string) {
    event.preventDefault();
    setDragDate(null);
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const item = JSON.parse(raw) as DueItem;
      if (item.kind === "followup") await run("reschedule_followup", { id: item.lead_id, followup_id: item.item_id, due: date });
      else await run("set_next_action", { id: item.lead_id, text: item.text, date });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "Could not reschedule" });
    }
  }

  function renderCalendar() {
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><button className="kc-btn kc-btn-secondary kc-icon-btn" onClick={() => setMonthOffset((m) => m - 1)}><ChevronLeft size={16} /></button><div className="min-w-[170px] text-center text-[16px] font-semibold tracking-[-0.02em]">{month.label}</div><button className="kc-btn kc-btn-secondary kc-icon-btn" onClick={() => setMonthOffset((m) => m + 1)}><ChevronRight size={16} /></button></div>
          <div className="flex items-center gap-2"><Pill tone="blue"><GripVertical size={11} /> Draggable</Pill><button className="kc-btn kc-btn-secondary" onClick={() => setMonthOffset(0)}>Today {today}</button></div>
        </div>
        <Panel title="Every next action and follow-up" description="Drag a chip to another day. The drop calls reschedule_followup or set_next_action; dates stay ISO. This is a calendar query, not a reminder engine.">
          <div className="grid grid-cols-7 border-t border-[rgba(60,60,67,.08)] bg-[rgba(250,250,252,.8)]">{weekdays.map((day) => <div key={day} className="px-2 py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-[#8a8e95]">{day}</div>)}</div>
          <div className="grid grid-cols-7">
            {month.dates.map((date) => {
              const items = dueByDate[date] ?? [];
              const inMonth = date.slice(0, 7) === month.first.slice(0, 7);
              return <div key={date} onDragOver={(e) => { e.preventDefault(); setDragDate(date); }} onDragLeave={() => setDragDate((current) => current === date ? null : current)} onDrop={(e) => void dropOnDate(e, date)} className={`kc-calendar-cell p-2 ${inMonth ? "" : "bg-[#fafafa] opacity-55"} ${dragDate === date ? "kc-drag-over" : ""}`}>
                <div className={`mb-1.5 flex items-center justify-between text-[11px] font-semibold ${date === today ? "text-[#1f1f21]" : "text-[#8a8e95]"}`}><span className="kc-mono">{date.slice(8)}</span>{date === today && <Pill tone="blue">Today</Pill>}</div>
                <div className="space-y-1">
                  {items.slice(0, 3).map((item) => <button key={`${item.item_id}-${item.date}`} draggable onDragStart={(e) => { e.dataTransfer.setData("application/json", JSON.stringify(item)); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDragDate(null)} onClick={() => openLead(item.lead_id)} className={`flex w-full cursor-grab items-start gap-1 rounded-lg px-1.5 py-1 text-left text-[10px] leading-tight ${item.kind === "followup" ? "bg-[rgba(120,140,170,.16)] text-[#34465c]" : "bg-[rgba(170,210,30,.09)] text-[#3b4700]"}`}><GripVertical size={10} className="mt-0.5 shrink-0" /><span className="truncate">{item.lead_name}: {item.text}</span></button>)}
                  {items.length > 3 && <div className="px-1.5 text-[10px] text-[#8a8e95]">+{items.length - 3} more</div>}
                </div>
              </div>;
            })}
          </div>
        </Panel>
      </div>
    );
  }

  function renderList() {
    const totalPages = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
    return (
      <div className="space-y-5">
        <Panel title="Filters & saved views" description="Filter by common fields or any nested field path such as sent.channel." actions={<><button className="kc-btn kc-btn-secondary" onClick={openSavedViewForm}><Plus size={13} /> Save view</button><button className="kc-btn kc-btn-primary" disabled={!selectedIds.length} onClick={openBulk}><LayersIcon /> Bulk ({selectedIds.length})</button></>}>
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <input className="kc-input" placeholder="Search all text" value={filters.q} onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setPage(1); }} />
              <select className="kc-input" value={filters.stage} onChange={(e) => { setFilters((f) => ({ ...f, stage: e.target.value })); setPage(1); }}><option value="all">All stages</option>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
              <select className="kc-input" value={filters.verdict} onChange={(e) => { setFilters((f) => ({ ...f, verdict: e.target.value })); setPage(1); }}><option value="all">All verdicts</option>{VERDICTS.map((v) => <option key={v}>{v}</option>)}</select>
              <input className="kc-input" placeholder="Town" value={filters.town} onChange={(e) => { setFilters((f) => ({ ...f, town: e.target.value })); setPage(1); }} />
              <input className="kc-input" placeholder="Tag" value={filters.tag} onChange={(e) => { setFilters((f) => ({ ...f, tag: e.target.value })); setPage(1); }} />
              <select className="kc-input" value={filters.dueWithin} onChange={(e) => { setFilters((f) => ({ ...f, dueWithin: e.target.value })); setPage(1); }}><option value="all">Any due date</option><option value="0">Due today or late</option><option value="7">Next 7 days</option><option value="30">Next 30 days</option></select>
              <input className="kc-input" placeholder="Any field path" value={filters.anyField} onChange={(e) => setFilters((f) => ({ ...f, anyField: e.target.value }))} />
              <input className="kc-input" placeholder="Value contains…" value={filters.anyValue} onChange={(e) => setFilters((f) => ({ ...f, anyValue: e.target.value }))} />
              <select className="kc-input" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}><option value="next_action">Sort: next action</option><option value="name">Sort: name</option><option value="verdict">Sort: verdict</option><option value="defects">Sort: defect count</option><option value="stage">Sort: stage</option><option value="updated_at">Sort: updated</option></select>
              <select className="kc-input" value={filters.archived} onChange={(e) => { setFilters((f) => ({ ...f, archived: e.target.value })); setPage(1); }}><option value="false">Active only</option><option value="true">Archived only</option><option value="all">All records</option></select>
              <button className="kc-btn kc-btn-secondary" onClick={() => { setFilters(DEFAULT_FILTERS); setPage(1); }}><RotateCcw size={13} /> Reset</button>
              <button className="kc-btn kc-btn-secondary" onClick={openNewLead}><Plus size={13} /> New lead</button>
            </div>
            {workspace.saved_views.length > 0 && <div className="flex flex-wrap items-center gap-2 border-t border-[rgba(60,60,67,.08)] pt-4"><span className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#8a8e95]">Saved:</span>{workspace.saved_views.map((saved) => <span key={text(saved.id)} className="inline-flex items-center gap-1 rounded-full border border-[rgba(60,60,67,.12)] bg-white pl-3 pr-1.5 py-1"><button className="text-[11.5px] font-semibold text-[#1f1f21]" onClick={() => { const savedFilter = (saved.filter ?? {}) as Json; const next = { ...DEFAULT_FILTERS }; for (const [key, value] of Object.entries(savedFilter)) if (key in next) (next as unknown as Json)[key] = Array.isArray(value) ? value.join(", ") : String(value ?? ""); setFilters(next); setPage(1); }}>{text(saved.name)}</button><button className="kc-btn kc-btn-ghost !min-h-[22px] !w-[22px] !p-0" title="Archive saved view" onClick={() => quick("archive_saved_view", { id: saved.id })}><X size={11} /></button></span>)}</div>}
          </div>
        </Panel>
        <Panel title={`${filteredLeads.length} matching leads`} description={`Page ${page} of ${totalPages} · stable IDs shown on every row.`} actions={<div className="flex items-center gap-2"><button className="kc-btn kc-btn-secondary !min-h-[32px] !px-3 !text-[11.5px]" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={13} /> Prev</button><button className="kc-btn kc-btn-secondary !min-h-[32px] !px-3 !text-[11.5px]" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight size={13} /></button></div>}>
          <div className="kc-scroll overflow-x-auto"><table className="kc-table min-w-[1120px]"><thead><tr><th><input type="checkbox" className="h-4 w-4 accent-[#1f1f21]" checked={visibleLeads.length > 0 && visibleLeads.every((l) => selectedIds.includes(l.id))} onChange={(e) => setSelectedIds(e.target.checked ? Array.from(new Set([...selectedIds, ...visibleLeads.map((l) => l.id)])) : selectedIds.filter((id) => !visibleLeads.some((l) => l.id === id)))} /></th><th>Lead</th><th>ID</th><th>Town / kind</th><th>Verdict</th><th>Stage</th><th>Defects</th><th>Next action</th><th>Updated</th><th /></tr></thead><tbody>
            {visibleLeads.map((lead) => <tr key={lead.id}>
              <td><input type="checkbox" className="h-4 w-4 accent-[#1f1f21]" checked={selectedIds.includes(lead.id)} onChange={() => setSelectedIds((ids) => ids.includes(lead.id) ? ids.filter((id) => id !== lead.id) : [...ids, lead.id])} /></td>
              <td><button className="text-left font-semibold hover:text-[#1f1f21]" onClick={() => openLead(lead.id)}>{lead.name}</button><div className="mt-0.5 text-[10.5px] text-[#8a8e95]">{text(lead.channel)} · Arm {lead.arm ?? "—"}</div></td>
              <td className="kc-mono text-[10.5px] text-[#8a8e95]">{lead.id}</td><td>{lead.town}<div className="mt-0.5 text-[10.5px] text-[#8a8e95]">{text(lead.kind)}</div></td>
              <td><Pill tone={verdictTone(lead.verdict)}>{lead.verdict}</Pill></td><td><Pill tone={stageTone(lead.stage)}>{lead.stage}</Pill></td>
              <td>{(lead.defects ?? []).filter((d) => !d.archived_at).length}</td>
              <td className="kc-mono text-[11px]">{lead.next_action ? `${lead.next_action.date}` : "—"}<div className="mt-0.5 max-w-[180px] truncate font-sans text-[10.5px] text-[#8a8e95]">{text(lead.next_action?.text)}</div></td>
              <td className="kc-mono text-[10.5px] text-[#8a8e95]">{stamp(lead.updated_at)}</td>
              <td><div className="flex justify-end gap-1"><button className="kc-btn kc-btn-ghost kc-icon-btn" onClick={() => openLead(lead.id)} title="Open lead"><ArrowRight size={15} /></button><button className="kc-btn kc-btn-ghost kc-icon-btn" title={lead.archived_at ? "Restore" : "Archive"} onClick={() => quick(lead.archived_at ? "restore_lead" : "archive_lead", { id: lead.id })}>{lead.archived_at ? <RotateCcw size={14} /> : <Archive size={14} />}</button></div></td>
            </tr>)}
            {!visibleLeads.length && <tr><td colSpan={10} className="py-12 text-center text-[#8a8e95]">No leads match these filters.</td></tr>}
          </tbody></table></div>
        </Panel>
      </div>
    );
  }

  function renderLibrary() {
    const tabs = [{ id: "documents", label: "Documents", icon: FileText }, { id: "testimonials", label: "Testimonials", icon: MessageSquare }, { id: "wins", label: "Wins", icon: Wallet }, { id: "templates", label: "Templates", icon: Sparkles }] as const;
    return (
      <div className="space-y-5">
        <div className="kc-noscrollbar overflow-x-auto"><Segmented variant="light" value={libraryTab} onChange={(id) => setLibraryTab(id as typeof libraryTab)} items={tabs.map((tab) => { const Icon = tab.icon; return { id: tab.id, label: tab.label, icon: <Icon size={13} />, count: tab.id === "documents" ? workspace.documents.length : tab.id === "testimonials" ? workspace.testimonials.length : tab.id === "wins" ? workspace.wins.length : workspace.templates.length }; })} /></div>
        <div key={libraryTab} className="kc-view-in space-y-5">{libraryTab === "documents" && <Panel title="Documents" description="Brand, operating and build documents. Archive instead of delete." actions={<button className="kc-btn kc-btn-primary" onClick={() => openDocumentForm()}><Plus size={13} /> New document</button>}>
          <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 sm:p-5">{workspace.documents.map((doc) => <article key={text(doc.id)} className="kc-card-flat flex flex-col p-4"><div className="flex items-start justify-between gap-2"><Pill tone={text(doc.kind) === "brand" ? "purple" : text(doc.kind) === "build" ? "blue" : "gray"}>{text(doc.kind)}</Pill><span className="kc-mono text-[10px] text-[#a1a1a6]">v{text(doc.version)}</span></div><h3 className="mt-3 text-[14px] font-semibold">{text(doc.title)}</h3><p className="mt-2 line-clamp-4 text-[12px] leading-relaxed text-[#6b6f76]">{text(doc.body)}</p><div className="kc-mono mt-3 text-[10px] text-[#a1a1a6]">{text(doc.id)} · {stamp(doc.updated_at)}</div><div className="mt-4 flex gap-1.5"><button className="kc-btn kc-btn-secondary !min-h-[32px] !px-3 !text-[11.5px]" onClick={() => openDocumentForm(doc)}><Pencil size={12} /> Edit</button><button className="kc-btn kc-btn-ghost !min-h-[32px] !px-3 !text-[11.5px]" onClick={() => quick("documents_archive", { id: doc.id })}><Archive size={12} /> Archive</button></div></article>)}{!workspace.documents.length && <div className="md:col-span-2 xl:col-span-3"><EmptyState icon={<BookOpen size={22} />} title="No documents" description="Create the first brand, operating or build document." /></div>}</div>
        </Panel>}
        {libraryTab === "testimonials" && <Panel title="Testimonials" description="Permission is explicit and archived testimonials remain in export." actions={<button className="kc-btn kc-btn-primary" onClick={() => openTestimonialForm()}><Plus size={13} /> Add testimonial</button>}>
          <div className="kc-scroll overflow-x-auto"><table className="kc-table min-w-[840px]"><thead><tr><th>Quote</th><th>Who / business</th><th>Date</th><th>Permission</th><th>ID</th><th /></tr></thead><tbody>{workspace.testimonials.map((item) => <tr key={text(item.id)}><td className="max-w-[360px] text-[12.5px] italic leading-relaxed">“{text(item.quote)}”</td><td><div className="font-semibold">{text(item.who)}</div><div className="text-[11px] text-[#8a8e95]">{text(item.business)}</div></td><td className="kc-mono">{text(item.date)}</td><td><Pill tone={item.permission_given ? "green" : "amber"}>{item.permission_given ? "Given" : "Not given"}</Pill></td><td className="kc-mono text-[10px] text-[#8a8e95]">{text(item.id)}</td><td><div className="flex justify-end gap-1"><button className="kc-btn kc-btn-ghost kc-icon-btn" onClick={() => openTestimonialForm(item)}><Pencil size={14} /></button><button className="kc-btn kc-btn-ghost kc-icon-btn" onClick={() => quick("testimonials_remove", { id: item.id })}><Archive size={14} /></button></div></td></tr>)}{!workspace.testimonials.length && <tr><td colSpan={6} className="py-10 text-center text-[#8a8e95]">No testimonials yet.</td></tr>}</tbody></table></div>
        </Panel>}
        {libraryTab === "wins" && <Panel title="Wins" description="Only money that landed. A Won stage without value_paid and paid_at is refused." actions={<button className="kc-btn kc-btn-primary" onClick={openWinForm}><Plus size={13} /> Record win</button>}>
          <div className="kc-scroll overflow-x-auto"><table className="kc-table min-w-[760px]"><thead><tr><th>Date</th><th>Lead</th><th>What</th><th>Amount</th><th>ID</th><th /></tr></thead><tbody>{workspace.wins.map((win) => <tr key={text(win.id)}><td className="kc-mono font-semibold">{text(win.date)}</td><td><button className="font-semibold hover:text-[#1f1f21]" onClick={() => openLead(text(win.lead_id))}>{workspace.leads.find((l) => l.id === text(win.lead_id))?.name ?? text(win.lead_id)}</button></td><td className="text-[12.5px]">{text(win.what)}</td><td className="font-semibold text-[#248a3d]">{money(win.amount)}</td><td className="kc-mono text-[10px] text-[#8a8e95]">{text(win.id)}</td><td><button className="kc-btn kc-btn-ghost kc-icon-btn" onClick={() => quick("wins_remove", { id: win.id })}><Archive size={14} /></button></td></tr>)}{!workspace.wins.length && <tr><td colSpan={6} className="py-10 text-center text-[#8a8e95]">No money recorded yet.</td></tr>}</tbody></table></div>
        </Panel>}
        {libraryTab === "templates" && <Panel title="Message templates" description="Facts are inserted from the lead: {name}, {town}, {kind}, {url}, {contact}, {defect}." actions={<button className="kc-btn kc-btn-primary" onClick={() => openTemplateForm()}><Plus size={13} /> New template</button>}>
          <div className="kc-scroll overflow-x-auto"><table className="kc-table min-w-[900px]"><thead><tr><th>Name</th><th>Channel</th><th>Subject</th><th>Body</th><th>ID</th><th /></tr></thead><tbody>{workspace.templates.map((tpl) => <tr key={text(tpl.id)}><td className="font-semibold">{text(tpl.name)}</td><td><Pill tone="blue">{text(tpl.channel)}</Pill></td><td className="text-[12.5px]">{text(tpl.subject)}</td><td className="max-w-[360px] truncate text-[12px] text-[#6b6f76]">{text(tpl.body)}</td><td className="kc-mono text-[10px] text-[#8a8e95]">{text(tpl.id)}</td><td><div className="flex justify-end gap-1"><button className="kc-btn kc-btn-ghost kc-icon-btn" onClick={() => openTemplateForm(tpl)}><Pencil size={14} /></button><button className="kc-btn kc-btn-ghost kc-icon-btn" onClick={() => quick("archive_record", { id: tpl.id })}><Archive size={14} /></button></div></td></tr>)}</tbody></table></div>
        </Panel>}</div>
      </div>
    );
  }

  function renderCommitments() {
    return (
      <div className="space-y-5">
        <Panel title="My loop" description="Last-run and next-run dates are ISO. No schedule engine runs these for you." actions={<button className="kc-btn kc-btn-primary" onClick={() => openCommitmentForm()}><Plus size={13} /> New commitment</button>}>
          <div className="kc-scroll overflow-x-auto"><table className="kc-table min-w-[920px]"><thead><tr><th>Task</th><th>What</th><th>Cadence</th><th>Last run</th><th>Next run</th><th>Owner</th><th /></tr></thead><tbody>
            {workspace.commitments.map((item) => { const overdue = text(item.next_run) && text(item.next_run) < today; return <tr key={text(item.id)}><td><div className="font-semibold">{text(item.task)}</div><div className="kc-mono mt-0.5 text-[10px] text-[#a1a1a6]">{text(item.id)}</div></td><td className="max-w-[320px] text-[12px] leading-relaxed text-[#6b6f76]">{text(item.what)}</td><td><Pill tone="gray">{text(item.cadence)}</Pill></td><td className="kc-mono">{text(item.last_run) || "—"}</td><td><span className="kc-mono font-semibold">{text(item.next_run)}</span>{overdue && <div className="mt-1"><Pill tone="red">{daysBetween(text(item.next_run), today)}d late</Pill></div>}</td><td>{text(item.owner)}</td><td><div className="flex justify-end gap-1"><button className="kc-btn kc-btn-secondary !min-h-[32px] !px-3 !text-[11.5px]" onClick={() => openCommitmentForm(item)}><CalendarClock size={12} /> Update</button><button className="kc-btn kc-btn-ghost kc-icon-btn" onClick={() => quick("archive_record", { id: item.id })}><Archive size={14} /></button></div></td></tr>; })}
            {!workspace.commitments.length && <tr><td colSpan={7} className="py-10 text-center text-[#8a8e95]">No commitments recorded.</td></tr>}
          </tbody></table></div>
        </Panel>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Panel title="Last write wins" description="Two people editing between turns is a real risk."><div className="p-5 text-[12.5px] leading-relaxed text-[#515154]">The app does not pretend to see future state. Every write is stamped with actor, time and field-level changes. Use <span className="kc-mono">history(record_id)</span> in the lead file to catch conflicts.</div></Panel>
          <Panel title="What wakes you up" description="Not the assistant."><div className="p-5 text-[12.5px] leading-relaxed text-[#515154]">If a reminder engine exists, that engine wakes you up — not me. This page only holds the dates; it does not watch an inbox or run at 07:00.</div></Panel>
        </div>
      </div>
    );
  }

  function renderLog() {
    const q = logFilter.toLowerCase();
    const logs = workspace.log.filter((l) => !q || `${text(l.what)} ${text(l.who)} ${text(l.lead_id)} ${text(l.at)}`.toLowerCase().includes(q)).slice().sort((a, b) => text(b.at).localeCompare(text(a.at)));
    const audits = workspace.audit.filter((a) => !q || `${text(a.what)} ${text(a.who)} ${text(a.entity_id)} ${text(a.lead_id)} ${text(a.action)}`.toLowerCase().includes(q));
    const histories = workspace.history.filter((h) => !q || `${text(h.record_id)} ${text(h.field)} ${text(h.who)} ${text(h.action)}`.toLowerCase().includes(q));
    const operations = workspace.operations.filter((o) => !q || `${text(o.action)} ${text(o.who)} ${text(o.id)}`.toLowerCase().includes(q));
    const tabs = [{ id: "journal", label: "Journal" }, { id: "audit", label: "Audit" }, { id: "history", label: "History" }, { id: "operations", label: "Operations" }] as const;
    return (
      <div className="space-y-5">
        <Panel title="Stamped activity" description="Every write is recorded as a log entry, an audit entry with changed fields, and a grouped operation." actions={<><input className="kc-input !min-h-[34px] !w-[220px] !py-1 !text-[12px]" placeholder="Filter by id, who, action…" value={logFilter} onChange={(e) => setLogFilter(e.target.value)} /><button className="kc-btn kc-btn-secondary" onClick={() => quick("undo_last", {})}><Undo2 size={13} /> Undo last</button></>}>
          <div className="kc-noscrollbar overflow-x-auto border-b border-black/5 px-4 py-3 sm:px-5"><Segmented variant="light" value={logTab} onChange={(id) => setLogTab(id as typeof logTab)} items={tabs.map((tab) => ({ id: tab.id, label: tab.label }))} /></div>
          {logTab === "journal" && <div className="kc-scroll max-h-[620px] overflow-y-auto"><table className="kc-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Lead</th><th>Operation</th></tr></thead><tbody>{logs.slice(0, 300).map((entry) => <tr key={text(entry.id)}><td className="kc-mono whitespace-nowrap">{stamp(entry.at)}</td><td><Pill tone={text(entry.who) === "System" ? "gray" : "blue"}>{text(entry.who)}</Pill></td><td className="text-[12.5px]">{text(entry.what)}</td><td className="kc-mono text-[10.5px]">{text(entry.lead_id) || "—"}</td><td className="kc-mono text-[10px] text-[#8a8e95]">{text(entry.operation_id) || "seed"}</td></tr>)}</tbody></table></div>}
          {logTab === "audit" && <div className="kc-scroll max-h-[620px] overflow-y-auto"><table className="kc-table min-w-[900px]"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>What</th><th>Fields</th></tr></thead><tbody>{audits.slice(0, 300).map((entry) => <tr key={text(entry.id)}><td className="kc-mono whitespace-nowrap">{stamp(entry.at)}</td><td>{text(entry.who)}</td><td className="kc-mono text-[11px]">{text(entry.action)}</td><td className="kc-mono text-[10.5px]">{text(entry.entity)} · {text(entry.entity_id)}</td><td className="text-[12px]">{text(entry.what)}</td><td>{entry.changes.length}</td></tr>)}</tbody></table></div>}
          {logTab === "history" && <div className="kc-scroll max-h-[620px] overflow-y-auto"><table className="kc-table min-w-[900px]"><thead><tr><th>When</th><th>Who</th><th>Record</th><th>Field</th><th>Old → New</th><th>Action</th></tr></thead><tbody>{histories.slice(0, 300).map((entry) => <tr key={text(entry.id)}><td className="kc-mono whitespace-nowrap">{stamp(entry.at)}</td><td>{text(entry.who)}</td><td className="kc-mono text-[10.5px]">{text(entry.record_id)}</td><td className="kc-mono">{text(entry.field)}</td><td className="max-w-[280px] truncate text-[11px] text-[#6b6f76]">{JSON.stringify(entry.old_value)} → {JSON.stringify(entry.new_value)}</td><td className="kc-mono text-[10px]">{text(entry.action)}</td></tr>)}</tbody></table></div>}
          {logTab === "operations" && <div className="kc-scroll max-h-[620px] overflow-y-auto"><table className="kc-table min-w-[760px]"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Records</th><th>Undo status</th><th>ID</th></tr></thead><tbody>{operations.map((op) => <tr key={text(op.id)}><td className="kc-mono whitespace-nowrap">{stamp(op.at)}</td><td>{text(op.who)}</td><td className="kc-mono text-[11px]">{text(op.action)}</td><td>{op.snapshots.length}</td><td>{op.undone_at ? <Pill tone="red">Undone {stamp(op.undone_at)}</Pill> : op.undoable === "false" ? <Pill tone="gray">Not undoable</Pill> : <Pill tone="green">Undoable</Pill>}</td><td className="kc-mono text-[10px] text-[#8a8e95]">{text(op.id)}</td></tr>)}</tbody></table></div>}
        </Panel>
      </div>
    );
  }

  function renderSettings() {
    return (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel title="Cadence & sending" description="settings.get / settings.update. Changing cadence affects future sends only." actions={<button className="kc-btn kc-btn-primary" onClick={openSettingsForm}><Pencil size={13} /> Edit settings</button>}>
            <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
              <div><TinyLabel>Cadence days</TinyLabel><div className="mt-2 flex gap-2">{(workspace.settings.cadence_days ?? []).map((day, i) => <Pill key={i} tone="blue">+{day} days → nudge {i + 1}</Pill>)}</div></div>
              <div><TinyLabel>Send windows</TinyLabel><div className="mt-2 flex flex-wrap gap-2">{(workspace.settings.send_windows ?? []).map((window) => <Pill key={window} tone="gray">{window}</Pill>)}</div></div>
              <div><TinyLabel>Daily quota</TinyLabel><div className="mt-1.5 text-[22px] font-semibold tracking-[-0.04em]">{workspace.settings.daily_quota}</div></div>
              <div><TinyLabel>A/B split</TinyLabel><div className="mt-1.5 text-[22px] font-semibold tracking-[-0.04em]">{workspace.settings.ab_split}% → A</div></div>
              <div className="sm:col-span-2"><TinyLabel>Channel order</TinyLabel><div className="mt-2 flex flex-wrap gap-2">{(workspace.settings.channel_order ?? []).map((channel, i) => <Pill key={channel} tone="purple">{i + 1}. {channel}</Pill>)}</div></div>
              <div className="sm:col-span-2"><TinyLabel>Timezone label</TinyLabel><div className="kc-mono mt-1.5 text-[12px]">{text(workspace.settings.timezone_label)}</div></div>
            </div>
          </Panel>
          <Panel title="Rules the engine enforces" description="These are hard refusals, not warnings in a tooltip."><div className="grid grid-cols-1 gap-2.5 p-5 sm:grid-cols-2">{GUARDRAILS.map((rule) => <div key={rule} className="flex items-start gap-2 rounded-xl bg-[#eef2f6] px-3 py-2.5 text-[12px] leading-relaxed text-[#3a3a3c]"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[#248a3d]" /> {rule}</div>)}</div></Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Write identity" description="Every write is stamped with who changed it."><div className="p-5"><label className="text-[12px] font-semibold text-[#515154]">Current actor</label><select className="kc-input mt-2" value={actor} onChange={(e) => { setActor(e.target.value); window.localStorage.setItem("kc_actor", e.target.value); }}>{["You", "Kgomotso", "Assistant"].map((name) => <option key={name}>{name}</option>)}</select><p className="mt-3 text-[11.5px] leading-relaxed text-[#8a8e95]">Audit, history and log entries use this value. There is no login; choose honestly.</p></div></Panel>
          <Panel title="No login doors" description="Export and API are the only doors."><div className="space-y-3 p-5 text-[12px] leading-relaxed text-[#515154]"><div className="flex gap-2"><Download size={15} className="shrink-0 text-[#1f1f21]" /> Full JSON or CSV export needs no login.</div><div className="flex gap-2"><Link2 size={15} className="shrink-0 text-[#1f1f21]" /> Function API: <span className="kc-mono">/api/fn/:name</span></div><div className="flex gap-2"><Upload size={15} className="shrink-0 text-[#1f1f21]" /> Import merges by ID and reports changes.</div><div className="flex gap-2"><ShieldCheck size={15} className="shrink-0 text-[#1f1f21]" /> Export includes schema version and timestamp.</div></div></Panel>
          <Panel title="No schedule" description="A reminder engine is not me."><div className="p-5 text-[12.5px] leading-relaxed text-[#515154]">I do not run on a schedule. I act when you message me. There is no 07:00 check and no watcher on an inbox.</div></Panel>
          <Panel title="Danger zone" description="Deleting seed data is the one hard delete in the desk. It is stamped and logged, and one click of Undo brings everything back. Audit history stays either way.">
            <div className="space-y-3 p-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(210,58,58,.18)] bg-[rgba(210,58,58,.05)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">Delete seed data</div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-[#6b6f76]">Removes the {workspace.records.filter((r) => r.id !== "settings" && /^(lead_kc_\d+|doc_\w+_\d+|test_\d+|win_\d+|com_\d+|tpl_\d+|view_\d+|log_seed_\d+)$/.test(r.id)).length} sample records — example leads, sample library, sample log entries. Records you created yourself and settings are not touched.</div>
                </div>
                <button className="kc-btn kc-btn-danger shrink-0" onClick={() => {
                  const seedCount = workspace.records.filter((r) => r.id !== "settings" && /^(lead_kc_\d+|doc_\w+_\d+|test_\d+|win_\d+|com_\d+|tpl_\d+|view_\d+|log_seed_\d+)$/.test(r.id)).length;
                  return open("Delete seed data?", `This removes ${seedCount} sample records from the desk: the example leads, the sample library and the sample log entries. Your own records and settings stay exactly as they are. The deletion is stamped and logged, and one click of Undo restores every record.`, [], async () => { await run("delete_seed_data", {}); }, { destructive: true, submitLabel: "Delete seed data" });
                }}><Trash2 size={13} /> Delete seed data</button>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(210,58,58,.18)] bg-[rgba(210,58,58,.05)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">Clear the entire desk</div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-[#6b6f76]">Removes every record — yours included — for a completely blank start. Settings survive, and the whole deletion is one undoable operation.</div>
                </div>
                <button className="kc-btn kc-btn-danger shrink-0" onClick={() => open("Clear the entire desk?", "Every lead, document, testimonial, win, commitment, template and log row is deleted. Settings keep their id and survive. Undo restores the entire desk in one step.", [], async () => { await run("reset_desk", {}); }, { destructive: true, submitLabel: "Delete everything" })}><AlertTriangle size={13} /> Delete everything</button>
              </div>
              <p className="text-[11px] leading-relaxed text-[#8a8e95]">Audit, history and log entries remain after either action, so you can still see who deleted what and when.</p>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  function renderTrash() {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(36,138,61,.18)] bg-[rgba(36,138,61,.06)] px-4 py-3 text-[12px] text-[#1c6e30]"><div className="flex items-center gap-2"><ShieldCheck size={15} /> Nothing is truly deleted. Archived child records stay inline in their parent. Trash has no destructive purge job.</div><div className="flex flex-wrap gap-2"><button className="kc-btn kc-btn-danger" onClick={() => quick("delete_seed_data", {})}><Trash2 size={13} /> Delete seed data</button><button className="kc-btn kc-btn-secondary" onClick={() => quick("undo_last", {})}><Undo2 size={13} /> Undo last operation</button></div></div>
        <Panel title={`${workspace.trash.length} archived records`} description="Archive, don't destroy — or keep a 30-day trash plus undo of the last operation. This desk keeps both." >
          <div className="kc-scroll overflow-x-auto"><table className="kc-table min-w-[850px]"><thead><tr><th>Type</th><th>Record</th><th>Immutable ID</th><th>Archived at</th><th>Days in trash</th><th /></tr></thead><tbody>
            {workspace.trash.slice().sort((a, b) => text(b.archived_at).localeCompare(text(a.archived_at))).map((row) => <tr key={row.id}><td><Pill tone="gray">{row.type}</Pill></td><td className="font-semibold">{text(row.data.name) || text(row.data.title) || text(row.data.task) || text(row.data.what) || text(row.data.quote) || row.id}</td><td className="kc-mono text-[10.5px] text-[#8a8e95]">{row.id}</td><td className="kc-mono">{stamp(row.archived_at)}</td><td>{row.archived_at ? Math.max(0, daysBetween(row.archived_at.slice(0, 10), today)) : "—"}</td><td><button className="kc-btn kc-btn-secondary !min-h-[32px] !px-3 !text-[11.5px]" onClick={() => quick("restore_record", { id: row.id })}><RotateCcw size={12} /> Restore</button></td></tr>)}
            {!workspace.trash.length && <tr><td colSpan={6} className="py-10 text-center text-[#8a8e95]">Trash is empty.</td></tr>}
          </tbody></table></div>
        </Panel>
      </div>
    );
  }

  function renderContract() {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { icon: <ShieldCheck size={17} />, title: "Stable ID", body: "Every record and child gets an immutable ID. Never a name, never a row number." },
            { icon: <CalendarClock size={17} />, title: "ISO always", body: "2026-11-02 and 2026-11-02T07:15:00Z. Never 02/11/26." },
            { icon: <Download size={17} />, title: "One-click export", body: "No login. Every object and child inline, schema version and export timestamp." },
            { icon: <Archive size={17} />, title: "Nothing deleted", body: "Archive, restore, 30-day trash and one-step undo for bulk writes." },
            { icon: <History size={17} />, title: "Stamped writes", body: "Who, when, what changed. Field-level history on every record." },
          ].map((item) => <div key={item.title} className="kc-card p-4"><div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-[rgba(170,210,30,.09)] text-[#1f1f21]">{item.icon}</div><h3 className="text-[13.5px] font-semibold">{item.title}</h3><p className="mt-1.5 text-[11.5px] leading-relaxed text-[#6b6f76]">{item.body}</p></div>)}
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel title="What no CRM can give me" description="Say it once, plainly, so no tool is bought expecting it."><div className="space-y-3 p-5">{REALITY.map((paragraph) => <p key={paragraph} className="border-l-2 border-[rgba(170,210,30,.35)] pl-3 text-[12.5px] leading-relaxed text-[#3a3a3c]">{paragraph}</p>)}</div></Panel>
          <Panel title="Export / import contract" description="Machine-readable, not a screenshot of a table."><div className="space-y-4 p-5 text-[12.5px] leading-relaxed text-[#515154]"><div><div className="font-semibold text-[#1d1d1f]">Export · P0</div><p className="mt-1">One file, one click, no login: <span className="kc-mono">lead-desk/1</span>, <span className="kc-mono">exported_at</span>, leads with children inline, documents, testimonials, wins, commitments, templates, saved views, log, audit, history, operations and settings.</p><div className="mt-3 flex flex-wrap gap-2"><button className="kc-btn kc-btn-primary" onClick={() => download("json")}><Download size={13} /> Export JSON</button><button className="kc-btn kc-btn-secondary" onClick={() => download("csv")}><Download size={13} /> Export CSV</button></div></div><div className="kc-hairline pt-4"><div className="font-semibold text-[#1d1d1f]">Import · P1</div><p className="mt-1">Merge by ID, never replace the whole database. Newer records merge field-by-field; older or identical records are skipped. Invalid evidence rules are reported as conflicts. Result: created / updated / skipped / conflicted.</p><div className="mt-3"><button className="kc-btn kc-btn-secondary" onClick={() => fileRef.current?.click()}><Upload size={13} /> Import JSON</button></div></div><div className="kc-hairline pt-4"><div className="font-semibold text-[#1d1d1f]">P0 cut</div><p className="mt-1">get_lead, list_leads, due_between, create_lead, update_lead, set_verdict, add_defect / remove_defect, set_message, mark_sent, log_touch and export_all — plus one Due today screen and a full export.</p></div></div></Panel>
        </div>
        <Panel title="Function API" description="GET reads: /api/fn/:name?args. POST writes: /api/fn/:name with { args, actor }. No login on /api/export."><div className="kc-scroll max-h-[540px] overflow-y-auto"><table className="kc-table min-w-[850px]"><thead><tr><th>Function</th><th>Method</th><th>Effect</th></tr></thead><tbody>{API_FUNCTIONS.map(([fn, method, effect]) => <tr key={fn}><td className="kc-mono text-[11.5px] font-semibold text-[#1f1f21]">{fn}</td><td><Pill tone={method.includes("GET") ? "green" : "blue"}>{method}</Pill></td><td className="text-[12px] text-[#515154]">{effect}</td></tr>)}</tbody></table></div></Panel>
        <Panel title="Enforced rules" description="The app refuses bad data rather than suggesting better data."><div className="grid grid-cols-1 gap-2.5 p-5 md:grid-cols-2">{GUARDRAILS.map((rule) => <div key={rule} className="flex gap-2 rounded-xl bg-[#eef2f6] px-3 py-2.5 text-[12px] text-[#3a3a3c]"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[#248a3d]" /> {rule}</div>)}</div></Panel>
      </div>
    );
  }

  function renderView() {
    switch (view) {
      case "due": return renderDue();
      case "queue": return renderQueue();
      case "pipeline": return renderPipeline();
      case "calendar": return renderCalendar();
      case "list": return renderList();
      case "library": return renderLibrary();
      case "commitments": return renderCommitments();
      case "log": return renderLog();
      case "settings": return renderSettings();
      case "trash": return renderTrash();
      case "contract": return renderContract();
    }
  }

  const reportArray = (value: unknown): Json[] => Array.isArray(value) ? value as Json[] : [];

  const workspaceNav = NAV.filter((n) => n.group === "Workspace");
  const otherNav = NAV.filter((n) => n.group !== "Workspace");
  const activeFilterCount = (actor !== "You" ? 1 : 0) + (range !== "all" ? 1 : 0) + (query.trim() ? 1 : 0);

  return (
    <div className="min-h-screen">
      <RevealObserver />
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
        <div className={`kc-topbar mx-auto flex max-w-[1480px] flex-wrap items-center gap-2.5 rounded-[28px] px-3 py-2.5 sm:px-4 ${scrolled ? "is-scrolled" : ""}`}>
          <button onClick={() => go("due")} className="flex shrink-0 items-center gap-2 pr-1" title="KgomotsoConversions">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#151517" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1" /></svg>
            <span className="hidden text-[15px] font-semibold tracking-[-0.03em] md:inline">kgomotso<span className="font-normal text-[#6b6f76]">conversions</span></span>
          </button>
          <div className="order-3 flex w-full min-w-0 justify-center lg:order-none lg:w-auto lg:flex-1">
            <div className="kc-noscrollbar max-w-full overflow-x-auto rounded-full">
              <Segmented variant="nav" value={workspaceNav.some((n) => n.id === view) ? view : "__none"} onChange={(id) => go(id as View)} items={workspaceNav.map((n) => {
                const Icon = n.icon;
                return { id: n.id, label: n.label, icon: <Icon size={14} />, count: n.id === "due" && dueToday.length ? dueToday.length : undefined };
              })} />
            </div>
          </div>
          <div className="kc-noscrollbar order-4 flex w-full gap-1.5 overflow-x-auto sm:order-none sm:w-auto">
            {otherNav.map((n) => {
              const Icon = n.icon;
              return <button key={n.id} title={n.label} aria-label={n.label} onClick={() => go(n.id)} className={`kc-round ${view === n.id ? "is-active" : ""}`}><Icon size={16} /></button>;
            })}
          </div>
          <span className="hidden h-6 w-px bg-black/10 sm:block" />
          <div className="ml-auto flex items-center gap-1.5 sm:ml-0">
            <button className="kc-round" title="Undo last operation" onClick={() => quick("undo_last", {})}><Undo2 size={16} /></button>
            <button className="kc-round" title="Import JSON (merge by id)" onClick={() => fileRef.current?.click()}><Upload size={16} /></button>
            <button className="kc-round relative" title="Due today" onClick={() => go("due")}><Bell size={16} />{dueToday.length > 0 && <span className="kc-pulse absolute right-2 top-2 h-2 w-2 rounded-full bg-[#9cc21a] ring-2 ring-white" />}</button>
            <Avatar name={actor} size={40} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1480px] px-3 pb-16 pt-6 sm:px-6 sm:pt-8">
        <div data-reveal className="mb-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <button className="kc-round !h-11 !w-11" title="Back to Due today" onClick={() => go("due")}><ChevronLeft size={18} /></button>
            <div className="min-w-0 overflow-hidden">
              <h1 key={view} className="kc-title-in truncate text-[40px] font-normal leading-[1.08] tracking-[-0.05em] sm:text-[54px]">{VIEW_META[view].title}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="kc-round !h-11 !w-11" title="Settings" onClick={() => go("settings")}><SlidersHorizontal size={17} /></button>
            <button className="kc-btn kc-btn-secondary !min-h-[44px] !px-5" onClick={() => download("csv")}><Download size={14} /> CSV</button>
            <button className="kc-btn kc-btn-dark !min-h-[44px] !px-5" onClick={openNewLead}><Plus size={15} /> New lead</button>
            {busy && <span className="kc-mono kc-fade text-[10px] text-[#8a8e95]">writing…</span>}
          </div>
        </div>
        <p key={`${view}-desc`} className="kc-fade mb-7 max-w-3xl pl-0 text-[13px] leading-relaxed text-[#6b6f76] sm:pl-[60px]">{VIEW_META[view].description} Today is <span className="kc-mono">{today}</span>.</p>

        {renderHero()}

        <div data-reveal className="relative z-20 mb-8 flex flex-wrap items-center gap-2.5">
          <div className="mr-1 flex items-center gap-2 text-[14px] font-medium">Active filters <span className="kc-count">{activeFilterCount}</span></div>
          <label className="kc-field-pill"><User size={14} className="text-[#8a8e95]" /><select aria-label="Write actor" value={actor} onChange={(e) => { setActor(e.target.value); window.localStorage.setItem("kc_actor", e.target.value); }}>{["You", "Kgomotso", "Assistant"].map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={14} className="pointer-events-none text-[#8a8e95]" /></label>
          <label className="kc-field-pill"><BarChart3 size={14} className="text-[#8a8e95]" /><select aria-label="Stats range" value={range} onChange={(e) => setRange(e.target.value)}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option></select><ChevronDown size={14} className="pointer-events-none text-[#8a8e95]" /></label>
          <span className="kc-field-pill"><span className="kc-mono !text-[12px]">{today}</span><CalendarDays size={14} className="text-[#8a8e95]" /></span>
          <div className="relative min-w-[240px] flex-1">
            <label className="kc-field-pill w-full"><input placeholder="Search name, town, defect, phone, notes…" value={query} onChange={(e) => setQuery(e.target.value)} /><Search size={15} className="shrink-0 text-[#8a8e95]" /></label>
            {searchResults.length > 0 && (
              <div data-lenis-prevent className="kc-pop kc-scroll absolute left-0 right-0 top-[50px] z-50 max-h-[340px] overflow-y-auto rounded-[22px] border border-white bg-white/95 p-1.5 shadow-[0_30px_60px_-20px_rgba(10,20,40,.35)] backdrop-blur-xl">
                {searchResults.map((result, i) => (
                  <button key={text(result.id)} onClick={() => openLead(text(result.id))} className="kc-fade flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-200 hover:bg-[#eef2f6]" style={{ animationDelay: `${i * 30}ms` }}>
                    <Avatar name={text(result.name)} size={30} />
                    <div className="min-w-0"><div className="truncate text-[12.5px] font-semibold">{text(result.name)}</div><div className="mt-0.5 text-[10.5px] text-[#8a8e95]">{text(result.town)} · {text(result.stage)} · {text(result.id)}</div></div>
                    <ArrowRight size={13} className="ml-auto shrink-0 text-[#a0a4ab]" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div key={view} className="kc-view-in">{renderView()}</div>

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-black/[.06] pt-5 text-[11px] text-[#8a8e95]"><span>KgomotsoConversions Lead Desk · schema lead-desk/1 · ISO dates · no login on export</span><span>Stable IDs · stamped writes · archive, never destroy</span></footer>
      </main>

      {selectedLead && <LeadFile lead={selectedLead} workspace={workspace} onClose={() => setSelectedId(null)} run={run} archived={Boolean(trashedLeadRow && !activeLead)} />}
      <ActionDialog spec={dialog} onClose={() => setDialog(null)} />
      {importReport && <SimpleModal title="Import merge report" description="Merged by ID. The database was never replaced wholesale." onClose={() => setImportReport(null)} wide><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[{ label: "Created", value: reportArray(importReport.created).length, tone: "green" as PillTone }, { label: "Updated", value: reportArray(importReport.updated).length, tone: "blue" as PillTone }, { label: "Skipped", value: reportArray(importReport.skipped).length, tone: "gray" as PillTone }, { label: "Conflicted", value: reportArray(importReport.conflicted).length, tone: "amber" as PillTone }].map((item) => <div key={item.label} className="kc-card-flat p-3.5"><TinyLabel>{item.label}</TinyLabel><div className="mt-1 text-[28px] font-normal tracking-[-0.04em]"><AnimatedNumber value={item.value} /></div><Pill tone={item.tone}>merge by id</Pill></div>)}</div><div className="kc-scroll mt-5 max-h-[280px] overflow-y-auto rounded-2xl bg-white/70 p-3">{reportArray(importReport.conflicted).concat(reportArray(importReport.created).slice(0, 12)).map((item, i) => <div key={i} className="kc-mono border-b border-black/5 py-2 text-[10.5px] last:border-0">{text(item.id)} — {text(item.reason) || text(item.type) || "created"}</div>)}{!reportArray(importReport.conflicted).length && !reportArray(importReport.created).length && <div className="py-3 text-[12px] text-[#8a8e95]">No created or conflicted records.</div>}</div><div className="mt-5 flex justify-end"><button className="kc-btn kc-btn-dark" onClick={() => setImportReport(null)}>Done</button></div></SimpleModal>}
      {toast && (
        <div key={toast.message} className={`kc-toast fixed bottom-6 right-6 z-[120] flex max-w-[420px] items-center gap-2.5 rounded-full py-2.5 pl-3 pr-4 text-[12.5px] font-medium text-white shadow-[0_24px_60px_-20px_rgba(0,0,0,.5)] ${toast.kind === "error" ? "bg-[#3a1518]" : "bg-[#1f1f21]"}`}>
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${toast.kind === "error" ? "bg-[#d23a3a]" : "bg-[#d8f65a] text-[#111]"}`}>{toast.kind === "error" ? <AlertTriangle size={14} /> : <Check size={14} />}</span>
          <span>{toast.message}</span>
          <button className="ml-1 opacity-60 transition-opacity hover:opacity-100" onClick={() => setToast(null)}><X size={13} /></button>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => void handleImport(event)} />
    </div>
  );
}

function LayersIcon() {
  return <Filter size={13} />;
}
