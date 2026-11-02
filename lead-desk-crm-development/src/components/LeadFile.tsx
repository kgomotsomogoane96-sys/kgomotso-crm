"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Archive, ArrowUpRight, CalendarClock, Camera, Check, ChevronRight, Copy, ExternalLink,
  FileText, History, Link2, MessageSquare, Pencil, Plus, RotateCcw, Send, Sparkles, Trash2, X,
} from "lucide-react";
import { ActionDialog, Pill, type DialogSpec, type Field, type PillTone } from "./ui";
import { Avatar, Segmented } from "./motion";
import type { Json, Lead, Workspace } from "@/lib/types";

type Props = {
  lead: Lead;
  workspace: Workspace;
  onClose: () => void;
  run: (name: string, args: Json) => Promise<unknown>;
  archived?: boolean;
};

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function stamp(value: unknown): string {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return `${raw.slice(0, 10)} ${raw.slice(11, 16)}`;
  return raw || "—";
}

function localInput(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
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

function preview(value: unknown): string {
  const unwrapped = value && typeof value === "object" && "value" in (value as Json) ? (value as Json).value : value;
  if (unwrapped === null || unwrapped === undefined || unwrapped === "") return "∅";
  const output = typeof unwrapped === "string" ? unwrapped : JSON.stringify(unwrapped);
  return output.length > 160 ? `${output.slice(0, 157)}…` : output;
}

function Card({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="kc-card-flat overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-[rgba(60,60,67,.09)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.02em]">{title}</h3>
          {description && <p className="mt-0.5 text-[11.5px] leading-relaxed text-[#8a8e95]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function LabelValue({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-[#8a8e95]">{label}</div>
      <div className={`mt-1 break-words text-[13px] text-[#3a3a3c] ${mono ? "kc-mono" : ""}`}>{text(value) || "—"}</div>
    </div>
  );
}

export default function LeadFile({ lead, workspace, onClose, run, archived = false, mode = "drawer" }: Props & { mode?: "drawer" | "page" }) {
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [tab, setTab] = useState<"all" | "identity" | "outreach" | "activity" | "history">("all");
  const [inlineError, setInlineError] = useState("");
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [leaving, setLeaving] = useState(false);

  function close() {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onClose, 280);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !dialog) close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    setProfile({
      name: text(lead.name), kind: text(lead.kind), town: text(lead.town), address: text(lead.address),
      url: text(lead.url), site_platform: text(lead.site_platform), channel: text(lead.channel),
      value_quoted: lead.value_quoted ? String(lead.value_quoted) : "",
      tags: (lead.tags ?? []).join(", "), research: text(lead.research),
    });
    setInlineError("");
  }, [lead.id, lead.updated_at]);

  async function act(name: string, args: Json) {
    try {
      await run(name, args);
      setInlineError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Operation failed";
      setInlineError(message);
      throw error;
    }
  }

  function open(title: string, description: string, fields: Field[], onSubmit: (values: Json) => Promise<void> | void, extra: Partial<DialogSpec> = {}) {
    setDialog({ title, description, fields, onSubmit, ...extra });
  }

  function direct(name: string, args: Json) {
    void act(name, args).catch(() => undefined);
  }

  const contacts = lead.contacts ?? [];
  const defects = lead.defects ?? [];
  const followups = lead.followups ?? [];
  const touches = lead.touches ?? [];
  const messageHistory = lead.message_history ?? [];
  const history = workspace.history.filter((h) => h.record_id === lead.id).slice(0, 100);
  const audit = workspace.audit.filter((a) => a.lead_id === lead.id).slice(0, 30);
  const screenshot = text(lead.screenshot);
  const isImage = screenshot.startsWith("http") || screenshot.startsWith("data:image");
  const today = workspace.generated_at.slice(0, 10);

  const identity = (
    <div className="space-y-4">
      <Card title="Business identity" description="Partial writes only. Specialised fields have their own stamped actions." actions={<button className="kc-btn kc-btn-ghost text-[#1f1f21]" onClick={async () => { await navigator.clipboard?.writeText(lead.id); }}><Copy size={13} /> Copy immutable ID</button>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            ["name", "Business name"], ["kind", "Kind"], ["town", "Town"], ["address", "Address"],
            ["url", "Website URL"], ["site_platform", "Site platform"],
          ].map(([key, label]) => (
            <label key={key}><span className="mb-1.5 block text-[11.5px] font-semibold text-[#515154]">{label}</span><input className="kc-input" value={profile[key] ?? ""} onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))} /></label>
          ))}
          <label><span className="mb-1.5 block text-[11.5px] font-semibold text-[#515154]">Preferred channel</span>
            <select className="kc-input" value={profile.channel ?? "WhatsApp"} onChange={(e) => setProfile((p) => ({ ...p, channel: e.target.value }))}>
              {["WhatsApp", "Email", "Call", "Walk-in"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label><span className="mb-1.5 block text-[11.5px] font-semibold text-[#515154]">Value quoted (ZAR)</span><input className="kc-input" type="number" value={profile.value_quoted ?? ""} onChange={(e) => setProfile((p) => ({ ...p, value_quoted: e.target.value }))} /></label>
          <label className="sm:col-span-2"><span className="mb-1.5 block text-[11.5px] font-semibold text-[#515154]">Tags (comma-separated)</span><input className="kc-input" value={profile.tags ?? ""} onChange={(e) => setProfile((p) => ({ ...p, tags: e.target.value }))} /></label>
          <label className="sm:col-span-2"><span className="mb-1.5 block text-[11.5px] font-semibold text-[#515154]">Research notes</span><textarea className="kc-input" rows={4} value={profile.research ?? ""} onChange={(e) => setProfile((p) => ({ ...p, research: e.target.value }))} /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="kc-btn kc-btn-primary" onClick={() => direct("update_lead", { id: lead.id, patch: { ...profile, value_quoted: profile.value_quoted ? Number(profile.value_quoted) : null } })}><Check size={14} /> Save profile</button>
          <button className="kc-btn kc-btn-secondary" onClick={() => direct("set_research", { id: lead.id, text: profile.research })}><FileText size={14} /> Save research only</button>
        </div>
      </Card>

      <Card title="Trading evidence" description="TRADING is impossible without proof and a proof source URL." actions={
        <button className="kc-btn kc-btn-secondary" onClick={() => open("Set verdict with proof", "TRADING requires non-empty proof and a full proof_source URL. Other verdicts may stay unconfirmed.", [
          { name: "verdict", label: "Verdict", type: "select", options: ["TRADING", "EXISTS", "UNCERTAIN"].map((v) => ({ value: v, label: v })), defaultValue: lead.verdict, required: true },
          { name: "verified_at", label: "Verified at (ISO date)", type: "date", defaultValue: text(lead.verified_at) || today, required: true },
          { name: "proof", label: "Proof", type: "textarea", defaultValue: text(lead.proof), span: true, help: "Reviews, listings, published rates or another observable fact." },
          { name: "proof_source", label: "Proof source URL", type: "url", defaultValue: text(lead.proof_source), span: true, placeholder: "https://…" },
        ], (v) => act("set_verdict", { id: lead.id, ...v }))}><Pencil size={13} /> Set verdict</button>
      }>
        <div className="mb-4 flex flex-wrap gap-2"><Pill tone={verdictTone(lead.verdict)}>{lead.verdict}</Pill><Pill tone="gray">Verified {text(lead.verified_at) || "not yet"}</Pill>{lead.is_bookmark && <Pill tone="amber">Bookmark only</Pill>}</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LabelValue label="Proof" value={lead.proof} />
          <div><div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-[#8a8e95]">Proof source</div>{text(lead.proof_source) ? <a href={text(lead.proof_source)} target="_blank" rel="noreferrer" className="kc-link mt-1 inline-flex items-center gap-1 break-all text-[13px]"><ExternalLink size={12} /> {text(lead.proof_source)}</a> : <div className="mt-1 text-[13px] text-[#3a3a3c]">—</div>}</div>
        </div>
      </Card>

      <Card title="Mobile capture & demo" description="Screenshots accept a URL or a local file. Demo attachment is the evidence for Demo built." actions={
        <>
          <button className="kc-btn kc-btn-secondary" onClick={() => open("Attach mobile screenshot", "Dates and capture timestamps are stored in ISO.", [
            { name: "file_or_url", label: "Screenshot file", type: "file", accept: "image/*" },
            { name: "url", label: "…or screenshot URL", type: "url", placeholder: "https://…" },
            { name: "captured_at", label: "Captured at", type: "datetime-local", defaultValue: localInput(), required: true },
          ], (v) => act("attach_screenshot", { id: lead.id, file_or_url: text(v.file_or_url) || undefined, url: text(v.url), captured_at: v.captured_at }))}><Camera size={13} /> Screenshot</button>
          <button className="kc-btn kc-btn-secondary" onClick={() => open("Attach demo", "A demo URL is required before stage Demo built.", [
            { name: "url", label: "Demo URL", type: "url", defaultValue: text(lead.demo?.url), required: true, span: true },
            { name: "built_at", label: "Built at", type: "datetime-local", defaultValue: localInput() },
            { name: "sent_at", label: "Sent at (optional)", type: "datetime-local" },
          ], (v) => act("attach_demo", { id: lead.id, ...v }))}><Link2 size={13} /> Attach demo</button>
        </>
      }>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_1fr]">
          <div className="flex h-[220px] w-[120px] items-center justify-center overflow-hidden rounded-[20px] border border-[rgba(60,60,67,.12)] bg-[#eef2f6]">
            {isImage ? <img src={screenshot} alt={`Mobile capture of ${lead.name}`} className="h-full w-full object-cover" /> : <Camera size={24} className="text-[#a1a1a6]" />}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LabelValue label="Screenshot captured at" value={stamp(lead.screenshot_captured_at)} mono />
            <LabelValue label="Demo built at" value={stamp(lead.demo?.built_at)} mono />
            <div className="sm:col-span-2"><div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-[#8a8e95]">Demo URL</div>{text(lead.demo?.url) ? <a className="kc-link mt-1 inline-flex items-center gap-1 break-all text-[13px]" href={text(lead.demo?.url)} target="_blank" rel="noreferrer"><ArrowUpRight size={13} /> {text(lead.demo?.url)}</a> : <div className="mt-1 text-[13px] text-[#3a3a3c]">—</div>}</div>
            <LabelValue label="Demo sent at" value={stamp(lead.demo?.sent_at)} mono />
          </div>
        </div>
      </Card>

      <Card title="Contacts" description="Many numbers per business. Removal archives the child record; it never destroys it." actions={
        <button className="kc-btn kc-btn-secondary" onClick={() => open("Add contact", "Every child record receives its own stable ID.", [
          { name: "name", label: "Name", required: true }, { name: "role", label: "Role" },
          { name: "phone", label: "Phone" }, { name: "whatsapp", label: "WhatsApp" },
          { name: "email", label: "Email", type: "email" }, { name: "is_owner", label: "Is owner", type: "checkbox" },
        ], (v) => act("add_contact", { id: lead.id, ...v }))}><Plus size={13} /> Add contact</button>
      }>
        <div className="space-y-2">
          {contacts.length === 0 && <p className="text-[13px] text-[#8a8e95]">No contacts recorded.</p>}
          {contacts.map((c) => (
            <div key={text(c.id)} className={`flex flex-col gap-2 rounded-xl border border-[rgba(60,60,67,.10)] p-3 sm:flex-row sm:items-center sm:justify-between ${c.archived_at ? "opacity-50" : ""}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold">{text(c.name) || "Unnamed contact"}</span>{truthy(c.is_owner) && <Pill tone="blue">Owner</Pill>}{Boolean(c.archived_at) && <Pill tone="gray">Archived</Pill>}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[#6b6f76]"><span>{text(c.role)}</span><span className="kc-mono">{text(c.phone)}</span><span className="kc-mono">{text(c.whatsapp)}</span><span>{text(c.email)}</span></div>
                <div className="kc-mono mt-1 text-[10px] text-[#a1a1a6]">{text(c.id)}</div>
              </div>
              <div className="flex gap-1.5">
                <button className="kc-btn kc-btn-ghost kc-icon-btn" title="Edit contact" onClick={() => open("Update contact", "Partial patch on child record " + text(c.id), [
                  { name: "name", label: "Name", defaultValue: text(c.name), required: true }, { name: "role", label: "Role", defaultValue: text(c.role) },
                  { name: "phone", label: "Phone", defaultValue: text(c.phone) }, { name: "whatsapp", label: "WhatsApp", defaultValue: text(c.whatsapp) },
                  { name: "email", label: "Email", type: "email", defaultValue: text(c.email) }, { name: "is_owner", label: "Is owner", type: "checkbox", defaultValue: Boolean(c.is_owner) },
                ], (v) => act("update_contact", { id: lead.id, contact_id: c.id, patch: v }))}><Pencil size={14} /></button>
                {!c.archived_at && <button className="kc-btn kc-btn-ghost kc-icon-btn" title="Archive contact" onClick={() => open("Archive contact?", "The contact stays in the export with archived_at. Undo can restore it.", [], () => act("remove_contact", { id: lead.id, contact_id: c.id }), { destructive: true, submitLabel: "Archive" })}><Archive size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Site defects" description="The observed reasons for outreach. Every defect has an ID, timestamp and page." actions={
        <button className="kc-btn kc-btn-secondary" onClick={() => open("Add defect", "A defect makes a bookmark into a lead.", [
          { name: "text", label: "What is wrong?", type: "textarea", required: true, span: true },
          { name: "page", label: "Page" }, { name: "found_at", label: "Found at", type: "datetime-local", defaultValue: localInput() },
        ], (v) => act("add_defect", { id: lead.id, ...v }))}><Plus size={13} /> Add defect</button>
      }>
        <div className="space-y-2">
          {defects.length === 0 && <p className="text-[13px] text-[#8a8e95]">No defects recorded. This may only be a bookmark.</p>}
          {defects.map((d) => (
            <div key={text(d.id)} className={`flex flex-col gap-2 rounded-xl border border-[rgba(60,60,67,.10)] p-3 sm:flex-row sm:items-start sm:justify-between ${d.archived_at ? "opacity-50" : ""}`}>
              <div><div className="text-[13px] leading-relaxed">{text(d.text)}</div><div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[#8a8e95]"><Pill tone="gray">{text(d.page) || "Site"}</Pill><span className="kc-mono">{stamp(d.found_at)}</span><span className="kc-mono">{text(d.id)}</span>{Boolean(d.archived_at) && <Pill tone="gray">Archived</Pill>}</div></div>
              <div className="flex shrink-0 gap-1.5">
                <button className="kc-btn kc-btn-ghost kc-icon-btn" title="Edit defect" onClick={() => open("Update defect", "Partial patch on " + text(d.id), [
                  { name: "text", label: "Defect", type: "textarea", defaultValue: text(d.text), required: true, span: true }, { name: "page", label: "Page", defaultValue: text(d.page) },
                ], (v) => act("update_defect", { id: lead.id, defect_id: d.id, patch: v }))}><Pencil size={14} /></button>
                {!d.archived_at && <button className="kc-btn kc-btn-ghost kc-icon-btn" title="Archive defect" onClick={() => open("Archive defect?", "Nothing is destroyed; archived_at is stamped and export still includes it.", [], () => act("remove_defect", { id: lead.id, defect_id: d.id }), { destructive: true, submitLabel: "Archive" })}><Trash2 size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  const outreach = (
    <div className="space-y-4">
      <Card title="Message draft" description={`Version ${lead.message?.version ?? 0}. Every save stores a new immutable version.`} actions={
        <>
          <button className="kc-btn kc-btn-secondary" onClick={() => open("Apply template", "Placeholders are filled from this lead's own facts.", [
            { name: "template_id", label: "Template", type: "select", options: workspace.templates.map((t) => ({ value: text(t.id), label: text(t.name) })), required: true, span: true },
          ], (v) => act("apply_template", { id: lead.id, ...v }))}><Sparkles size={13} /> Apply template</button>
          <button className="kc-btn kc-btn-secondary" onClick={() => open("Save message version", "This stores a new version, word count and generated_at timestamp.", [
            { name: "subject", label: "Subject", defaultValue: text(lead.message?.subject), required: true, span: true },
            { name: "body", label: "Body", type: "textarea", rows: 7, defaultValue: text(lead.message?.body), required: true, span: true },
            { name: "channel", label: "Channel", type: "select", options: ["WhatsApp", "Email", "Call", "Walk-in"].map((c) => ({ value: c, label: c })), defaultValue: text(lead.message?.channel) || lead.channel, required: true },
            { name: "arm", label: "A/B arm", type: "select", options: [{ value: "A", label: "A" }, { value: "B", label: "B" }], defaultValue: lead.arm ?? "A" },
          ], (v) => act("set_message", { id: lead.id, ...v }))}><Pencil size={13} /> New version</button>
        </>
      }>
        {lead.message ? (
          <div className="rounded-xl border border-[rgba(60,60,67,.10)] bg-[#fafafa] p-4">
            <div className="flex flex-wrap items-center gap-2"><Pill tone="blue">{lead.message.channel}</Pill><Pill tone="gray">Arm {lead.arm ?? "—"}</Pill><Pill tone="gray">{lead.message.words} words</Pill><span className="kc-mono ml-auto text-[10.5px] text-[#8a8e95]">{stamp(lead.message.generated_at)}</span></div>
            <h4 className="mt-3 text-[14px] font-semibold">{lead.message.subject}</h4>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[#3a3a3c]">{lead.message.body}</p>
          </div>
        ) : <p className="text-[13px] text-[#8a8e95]">No draft yet. Create a message before marking it sent.</p>}
        {messageHistory.length > 1 && <details className="mt-3"><summary className="cursor-pointer text-[12px] font-semibold text-[#1f1f21]">Message history ({messageHistory.length} versions)</summary><div className="mt-2 space-y-2">{messageHistory.map((m, i) => <div key={i} className="rounded-lg border border-[rgba(60,60,67,.09)] p-2.5 text-[11.5px]"><Pill tone="gray">v{m.version}</Pill> <span className="ml-2 font-semibold">{text(m.subject)}</span><span className="kc-mono ml-2 text-[#8a8e95]">{stamp(m.generated_at)}</span></div>)}</div></details>}
      </Card>

      <Card title="Outreach state" description="mark_sent is the only path to Sent. Sending is evidence, not a dropdown choice." actions={
        <>
          {!lead.sent?.at && <button className="kc-btn kc-btn-primary" onClick={() => open("Mark message sent", "One stamped write: records sent, appends a touch, generates all three cadence follow-ups, sets next_action and moves stage to Sent. A human clicked to send.", [
            { name: "channel", label: "Channel", type: "select", options: ["WhatsApp", "Email", "Call", "Walk-in"].map((c) => ({ value: c, label: c })), defaultValue: text(lead.message?.channel) || lead.channel, required: true },
            { name: "at", label: "Sent at", type: "datetime-local", defaultValue: localInput() },
          ], (v) => act("mark_sent", { id: lead.id, ...v }))}><Send size={13} /> Mark sent</button>}
          <button className="kc-btn kc-btn-secondary" onClick={() => open("Set next action", "Dates are ISO YYYY-MM-DD.", [
            { name: "text", label: "The one thing due next", required: true, span: true, defaultValue: text(lead.next_action?.text) },
            { name: "date", label: "Due date", type: "date", defaultValue: text(lead.next_action?.date) || today, required: true },
          ], (v) => act("set_next_action", { id: lead.id, ...v }))}><CalendarClock size={13} /> Next action</button>
          <button className="kc-btn kc-btn-secondary" onClick={() => open("Complete next action", "Closes the action and logs an append-only touch.", [
            { name: "note", label: "Completion note", type: "textarea", required: true, span: true },
          ], (v) => act("complete_next_action", { id: lead.id, ...v }))}><Check size={13} /> Complete</button>
        </>
      }>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <LabelValue label="Stage" value={lead.stage} /><LabelValue label="A/B arm" value={lead.arm ?? "—"} />
          <LabelValue label="Sent at" value={stamp(lead.sent?.at)} mono /><LabelValue label="Sent by" value={text(lead.sent?.by)} />
          <LabelValue label="Sent channel" value={text(lead.sent?.channel)} /><LabelValue label="Stage changed" value={stamp(lead.stage_changed_at)} mono />
          <LabelValue label="Created" value={stamp(lead.created_at)} mono /><LabelValue label="Updated" value={stamp(lead.updated_at)} mono />
        </div>
        <div className="mt-4 rounded-xl bg-[#eef2f6] p-3.5">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-[#8a8e95]">Next action</div>
          <div className="mt-1 text-[13px] font-medium">{lead.next_action ? `${lead.next_action.date} — ${text(lead.next_action.text)}` : "Nothing due"}</div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="kc-btn kc-btn-secondary" onClick={() => open("Advance stage with evidence", "Sent, Replied, Won, Lost and Parked have dedicated evidence-based actions. Demo built needs a demo; Meeting needs a reply.", [
            { name: "stage", label: "Allowed stage", type: "select", options: ["Sourced", "Demo built", "Meeting"].map((s) => ({ value: s, label: s })), required: true, defaultValue: "Demo built" },
          ], (v) => act("set_stage", { id: lead.id, ...v }))}><ChevronRight size={13} /> Set stage</button>
          <button className="kc-btn kc-btn-secondary" onClick={() => open("Record reply", "Every reply moves stage to Replied and stops all incomplete cadence nudges.", [
            { name: "text", label: "Reply text", type: "textarea", required: true, span: true },
            { name: "channel", label: "Channel", type: "select", options: ["WhatsApp", "Email", "Call", "Walk-in"].map((c) => ({ value: c, label: c })), defaultValue: lead.channel, required: true },
            { name: "at", label: "Received at", type: "datetime-local", defaultValue: localInput() },
          ], (v) => act("record_reply", { id: lead.id, ...v }))}><MessageSquare size={13} /> Record reply</button>
          <button className="kc-btn kc-btn-secondary" onClick={() => open("Close lead", "Won requires a positive amount and paid_at. Nothing counts as a win until money landed.", [
            { name: "result", label: "Result", type: "select", options: [{ value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "parked", label: "Parked" }], required: true, defaultValue: "lost" },
            { name: "reason", label: "Reason", required: true, span: true, type: "textarea" },
            { name: "value", label: "Amount (required for Won)", type: "number" },
            { name: "paid_at", label: "Paid at (required for Won)", type: "date", defaultValue: today },
          ], (v) => act("close_lead", { id: lead.id, result: v.result, reason: v.reason, value: v.value, amount: v.value, paid_at: v.paid_at }))}><Archive size={13} /> Close lead</button>
          <button className="kc-btn kc-btn-secondary" onClick={() => open("Record win payment", "Use this only when the money has actually landed. It creates a Win and sets value_paid / paid_at.", [
            { name: "amount", label: "Amount received (ZAR)", type: "number", required: true },
            { name: "date", label: "Payment date", type: "date", defaultValue: today, required: true },
            { name: "what", label: "What was paid for", required: true, span: true },
          ], (v) => act("record_win", { id: lead.id, ...v }))}><Sparkles size={13} /> Record win</button>
        </div>
      </Card>

      <Card title="Cadence follow-ups" description={`Generated from settings [${(workspace.settings.cadence_days ?? []).join(", ")}] at the moment of sending. Never typed.`} actions={
        lead.sent?.at && !lead.reply?.at && <button className="kc-btn kc-btn-secondary" onClick={() => open("Generate missing cadence follow-up", "The due date and wording are derived from the sent timestamp and cadence settings. Manual due/what values are rejected.", [
          { name: "cadence_index", label: "Cadence position", type: "select", options: [{ value: "0", label: "1 — first nudge" }, { value: "1", label: "2 — second nudge" }, { value: "2", label: "3 — close the loop" }], required: true },
        ], (v) => act("add_followup", { id: lead.id, cadence_index: Number(v.cadence_index) }))}><Plus size={13} /> Generate missing</button>
      }>
        <div className="space-y-2">
          {followups.length === 0 && <p className="text-[13px] text-[#8a8e95]">No follow-ups. They are created by mark_sent.</p>}
          {followups.map((f) => (
            <div key={text(f.id)} className="flex flex-col gap-2 rounded-xl border border-[rgba(60,60,67,.10)] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="flex flex-wrap items-center gap-2"><span className="kc-mono text-[12px] font-semibold text-[#1f1f21]">{text(f.due)}</span><span className="text-[13px]">{text(f.what)}</span>{Boolean(f.done) && <Pill tone="green">Done</Pill>}{Boolean(f.stopped_by_reply) && <Pill tone="purple">Stopped by reply</Pill>}{Boolean(f.generated) && <Pill tone="gray">Generated</Pill>}</div><div className="kc-mono mt-1 text-[10px] text-[#a1a1a6]">{text(f.id)}{f.done_at ? ` · done ${stamp(f.done_at)}` : ""}</div></div>
              {!f.done && !lead.reply?.at && <div className="flex gap-1.5">
                <button className="kc-btn kc-btn-secondary" onClick={() => open("Reschedule follow-up", "Drag-and-drop on Calendar uses the same stamped operation.", [
                  { name: "due", label: "New ISO due date", type: "date", defaultValue: text(f.due), required: true },
                ], (v) => act("reschedule_followup", { id: lead.id, followup_id: f.id, due: v.due }))}>Reschedule</button>
                <button className="kc-btn kc-btn-primary" onClick={() => open("Complete follow-up", "Closes the nudge and appends a touch.", [
                  { name: "note", label: "Note", type: "textarea", required: true, span: true },
                ], (v) => act("complete_followup", { id: lead.id, followup_id: f.id, note: v.note }))}><Check size={13} /> Complete</button>
              </div>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  const activity = (
    <div className="space-y-4">
      <Card title="Reply, outcome & money" description="A Won stage with no amount is a contradiction the app refuses.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LabelValue label="Reply text" value={text(lead.reply?.text)} />
          <LabelValue label="Reply at / channel" value={lead.reply ? `${stamp(lead.reply.at)} · ${text(lead.reply.channel)}` : ""} />
          <LabelValue label="Outcome" value={lead.outcome ? `${text(lead.outcome.result)} — ${text(lead.outcome.reason)}` : ""} />
          <LabelValue label="Outcome at" value={stamp(lead.outcome?.at)} mono />
          <LabelValue label="Value quoted" value={lead.value_quoted ? `R ${Number(lead.value_quoted).toLocaleString("en-ZA")}` : ""} />
          <LabelValue label="Value paid" value={lead.value_paid ? `R ${Number(lead.value_paid).toLocaleString("en-ZA")}` : ""} />
          <LabelValue label="Paid at" value={text(lead.paid_at)} mono />
          <LabelValue label="Immutable lead ID" value={lead.id} mono />
        </div>
      </Card>
      <Card title="Touches" description="Append-only. To correct an entry, add a new touch with a correction note; old entries cannot be edited into a lie." actions={
        <button className="kc-btn kc-btn-secondary" onClick={() => open("Log touch", "Inbound or outbound, including left a voicemail. Each touch is stamped with who and when.", [
          { name: "at", label: "At", type: "datetime-local", defaultValue: localInput() },
          { name: "channel", label: "Channel", type: "select", options: ["WhatsApp", "Email", "Call", "Walk-in"].map((c) => ({ value: c, label: c })), defaultValue: lead.channel, required: true },
          { name: "direction", label: "Direction", type: "select", options: [{ value: "outbound", label: "Outbound" }, { value: "inbound", label: "Inbound" }], defaultValue: "outbound", required: true },
          { name: "outcome", label: "Outcome", placeholder: "Left a voicemail", required: true },
          { name: "note", label: "Note", type: "textarea", span: true },
        ], (v) => act("log_touch", { id: lead.id, ...v }))}><Plus size={13} /> Log touch</button>
      }>
        <div className="space-y-2">
          {touches.length === 0 && <p className="text-[13px] text-[#8a8e95]">No touches yet.</p>}
          {touches.slice().reverse().map((t) => (
            <div key={text(t.id)} className="rounded-xl border border-[rgba(60,60,67,.10)] p-3">
              <div className="flex flex-wrap items-center gap-2"><Pill tone={t.direction === "inbound" ? "purple" : "blue"}>{text(t.direction)}</Pill><Pill tone="gray">{text(t.channel)}</Pill><span className="text-[13px] font-semibold">{text(t.outcome)}</span><span className="kc-mono ml-auto text-[10.5px] text-[#8a8e95]">{stamp(t.at)}</span></div>
              {text(t.note) && <p className="mt-2 text-[12px] leading-relaxed text-[#515154]">{text(t.note)}</p>}
              <div className="kc-mono mt-2 text-[10px] text-[#a1a1a6]">{text(t.id)} · by {text(t.by)}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Recent stamped writes" description="Audit entries for this lead, most recent first.">
        <div className="space-y-2">
          {audit.length === 0 && <p className="text-[13px] text-[#8a8e95]">No audit entries yet.</p>}
          {audit.map((a) => <div key={text(a.id)} className="rounded-xl bg-[#fafafa] p-3 text-[12px]"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{text(a.what)}</span><Pill tone="gray">{text(a.who)}</Pill><span className="kc-mono ml-auto text-[10.5px] text-[#8a8e95]">{stamp(a.at)}</span></div><div className="kc-mono mt-1 text-[10px] text-[#a1a1a6]">{text(a.action)} · {text(a.operation_id)} · {a.changes.length} field(s)</div></div>)}
        </div>
      </Card>
    </div>
  );

  const historyView = (
    <Card title="history(record_id)" description="Field, old value, new value, who and when. Last write wins; this is how you catch it." actions={<Pill tone="gray">{history.length} changes</Pill>}>
      <div className="kc-scroll max-h-[560px] overflow-y-auto">
        <table className="kc-table"><thead><tr><th>When</th><th>Who</th><th>Field</th><th>Old</th><th>New</th><th>Action</th></tr></thead><tbody>
          {history.map((h) => <tr key={text(h.id)}><td className="kc-mono whitespace-nowrap">{stamp(h.at)}</td><td>{text(h.who)}</td><td className="kc-mono">{text(h.field)}</td><td className="max-w-[180px] break-words text-[11px] text-[#8a8e95]">{preview(h.old_value)}</td><td className="max-w-[180px] break-words text-[11px]">{preview(h.new_value)}</td><td className="kc-mono text-[10px]">{text(h.action)}</td></tr>)}
          {!history.length && <tr><td colSpan={6} className="py-8 text-center text-[#8a8e95]">No field-level history yet.</td></tr>}
        </tbody></table>
      </div>
    </Card>
  );

  return (
    <div className={mode === "page" ? "min-h-screen" : "fixed inset-0 z-[70]"}>
      {mode === "drawer" && <button aria-label="Close lead file" className={`kc-backdrop absolute inset-0 cursor-default bg-[rgba(18,22,30,.3)] backdrop-blur-[4px] ${leaving ? "is-out" : ""}`} onClick={close} />}
      <aside data-lenis-prevent className={mode === "page"
        ? `kc-scroll w-full bg-[linear-gradient(180deg,#eef2f7,#e3e9f0)] ${leaving ? "is-out" : ""}`
        : `kc-sheet kc-scroll absolute right-0 top-0 h-full w-full overflow-y-auto border-l border-white/80 bg-[linear-gradient(180deg,#eef2f7,#e3e9f0)] shadow-[-30px_0_90px_-20px_rgba(10,20,40,.35)] sm:max-w-[900px] sm:rounded-l-[34px] ${leaving ? "is-out" : ""}`}>
        <header className="kc-glass sticky top-0 z-10 border-b border-white/80 px-4 py-4 sm:px-7 sm:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <Avatar name={lead.name} size={52} />
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2"><Pill tone={stageTone(lead.stage)}>{lead.stage}</Pill><Pill tone={verdictTone(lead.verdict)}>{lead.verdict}</Pill>{archived && <Pill tone="red">Archived</Pill>}<span className="kc-mono text-[10.5px] text-[#8a8e95]">#{lead.id}</span></div>
                <h2 className="truncate text-[26px] font-normal tracking-[-0.045em] sm:text-[32px]">{lead.name}</h2>
                <p className="mt-0.5 text-[12px] text-[#6b6f76]">{lead.kind || "Business"} · {lead.town} · ID never changes · all dates ISO</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {!archived ? <button className="kc-round" title="Archive lead" onClick={() => open("Archive lead?", "Archive, don't destroy. The lead remains in export and can be restored from Trash or undo.", [], () => act("archive_lead", { id: lead.id }), { destructive: true, submitLabel: "Archive" })}><Archive size={16} /></button> : <button className="kc-round" title="Restore lead" onClick={() => direct("restore_lead", { id: lead.id })}><RotateCcw size={16} /></button>}
              <button className="kc-round" title="Close" onClick={close}><X size={18} /></button>
            </div>
          </div>
          <div className="kc-noscrollbar mt-4 overflow-x-auto">
            <Segmented variant="light" value={tab} onChange={(id) => setTab(id as typeof tab)} items={[
              { id: "all", label: "Everything" }, { id: "identity", label: "Identity" }, { id: "outreach", label: "Outreach" },
              { id: "activity", label: "Activity", count: touches.length }, { id: "history", label: "History", icon: <History size={12} />, count: history.length },
            ]} />
          </div>
          {inlineError && <div className="kc-pop mt-3 rounded-2xl border border-[rgba(210,58,58,.2)] bg-[rgba(210,58,58,.07)] px-3.5 py-2 text-[12px] text-[#a82222]">{inlineError}</div>}
        </header>
        <div key={tab} className="kc-view-in space-y-4 px-4 py-5 sm:px-7 sm:py-6">
          {tab === "all" ? <>{identity}{outreach}{activity}{historyView}</> : null}
          {tab === "identity" ? identity : null}
          {tab === "outreach" ? outreach : null}
          {tab === "activity" ? activity : null}
          {tab === "history" ? historyView : null}
        </div>
      </aside>
      <ActionDialog spec={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function truthy(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1" || value === "yes";
}
