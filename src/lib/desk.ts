import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEntries,
  deskOperations,
  deskRecords,
  historyEntries,
  type EntitySnapshot,
} from "@/db/schema";
import { makeSeedRecords } from "./seed";
import type {
  BaseRecord,
  Channel,
  CloseResult,
  DeskRow,
  Direction,
  DueItem,
  HistoryEntry,
  Json,
  Lead,
  Message,
  Operation,
  Settings,
  Stage,
  Verdict,
  Workspace,
} from "./types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbRow = typeof deskRecords.$inferSelect;

type Ctx = {
  tx: Tx;
  opId: string;
  action: string;
  actor: string;
  snapshots: Map<string, DeskRow | null>;
  logIndex: number;
  undoable: boolean;
};

const SCHEMA = "lead-desk/1" as const;
const STAGES: Stage[] = ["Sourced", "Demo built", "Sent", "Replied", "Meeting", "Won", "Lost", "Parked"];
const VERDICTS: Verdict[] = ["TRADING", "EXISTS", "UNCERTAIN"];
const CHANNELS: Channel[] = ["WhatsApp", "Email", "Call", "Walk-in"];
const DEFAULT_CADENCE = [2, 5, 9];
const FOLLOWUP_LABELS = ["check delivery", "share one useful tip", "close the loop"];

const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  cadence_days: DEFAULT_CADENCE,
  send_windows: ["08:30", "11:30", "14:30", "16:30"],
  daily_quota: 12,
  ab_split: 50,
  channel_order: CHANNELS,
  timezone_label: "Africa/Johannesburg (UTC+02:00)",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function uid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

function now(): string {
  return new Date().toISOString();
}

function today(): string {
  return now().slice(0, 10);
}

function asString(value: unknown, fallback = ""): string {
  return value === undefined || value === null ? fallback : String(value).trim();
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function assertDate(value: unknown, label = "date"): string {
  const text = asString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must be an ISO date (YYYY-MM-DD).`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} is not a valid ISO calendar date.`);
  }
  return text;
}

function assertTimestamp(value: unknown, label = "timestamp"): string {
  if (value === undefined || value === null || value === "") return now();
  const text = asString(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    throw new Error(`${label} must be an ISO timestamp (YYYY-MM-DDTHH:mm).`);
  }
  const hasZone = /(Z|[+-]\d{2}:\d{2})$/.test(text);
  const normalized = text.length === 16 ? `${text}:00${hasZone ? "" : "Z"}` : text;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is not a valid ISO timestamp.`);
  return parsed.toISOString();
}

function addDays(stamp: string, days: number): string {
  const d = new Date(stamp.length === 10 ? `${stamp}T00:00:00.000Z` : stamp);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = new Date(`${assertDate(fromDate)}T00:00:00.000Z`).getTime();
  const b = new Date(`${assertDate(toDate)}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  const text = asString(value);
  if (!options.includes(text as T)) throw new Error(`${label} must be one of: ${options.join(", ")}.`);
  return text as T;
}

function truthy(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1" || value === "yes";
}

function rowFromDb(row: DbRow): DeskRow {
  return {
    id: row.id,
    type: row.type,
    data: row.data,
    archived_at: row.archivedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function diff(before: Json, after: Json): Json[] {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changes: Json[] = [];
  for (const key of keys) {
    if (key === "updated_at") continue;
    const oldValue = before[key] ?? null;
    const newValue = after[key] ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ field: key, old: oldValue, new: newValue });
    }
  }
  return changes;
}

async function readRowSource(tx: Tx, id: string): Promise<DeskRow | null> {
  const rows = await tx.select().from(deskRecords).where(eq(deskRecords.id, id)).limit(1);
  return rows[0] ? rowFromDb(rows[0]) : null;
}

async function readRow(ctx: Ctx, id: string): Promise<DeskRow | null> {
  return readRowSource(ctx.tx, id);
}

async function snapshot(ctx: Ctx, id: string): Promise<DeskRow | null> {
  if (!ctx.snapshots.has(id)) ctx.snapshots.set(id, await readRow(ctx, id));
  return ctx.snapshots.get(id) ?? null;
}

type WriteOptions = {
  what?: string;
  leadId?: string | null;
  action?: string;
  audit?: boolean;
  history?: boolean;
};

async function writeRow(ctx: Ctx, row: DeskRow, options: WriteOptions = {}): Promise<void> {
  const before = await snapshot(ctx, row.id);
  const at = now();
  const entity = row.type;
  const what = options.what ?? `${options.action ?? ctx.action} on ${entity} ${row.id}`;
  const changes = diff(before?.data ?? {}, row.data);
  await ctx.tx
    .insert(deskRecords)
    .values({
      id: row.id,
      type: row.type,
      data: row.data,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
    .onConflictDoUpdate({
      target: deskRecords.id,
      set: {
        type: row.type,
        data: row.data,
        archivedAt: row.archived_at,
        updatedAt: row.updated_at,
      },
    });
  if (options.audit !== false) {
    await ctx.tx.insert(auditEntries).values({
      id: uid("aud"),
      at,
      who: ctx.actor,
      action: options.action ?? ctx.action,
      entity,
      entityId: row.id,
      leadId: entity === "lead" ? row.id : (options.leadId ?? null),
      what,
      changes,
      operationId: ctx.opId,
    });
  }
  if (options.history !== false) {
    for (const change of changes) {
      await ctx.tx.insert(historyEntries).values({
        id: uid("his"),
        at,
        who: ctx.actor,
        action: options.action ?? ctx.action,
        recordId: row.id,
        field: asString(change.field),
        oldValue: { value: change.old ?? null },
        newValue: { value: change.new ?? null },
        operationId: ctx.opId,
      });
    }
  }
}

async function appendLog(ctx: Ctx, what: string, leadId?: string | null): Promise<void> {
  const id = `log_${ctx.opId}_${ctx.logIndex++}`;
  const at = now();
  const data: Json = {
    id,
    at,
    who: ctx.actor,
    what,
    lead_id: leadId ?? null,
    operation_id: ctx.opId,
    created_at: at,
    updated_at: at,
  };
  await writeRow(
    ctx,
    { id, type: "log", data, archived_at: null, created_at: at, updated_at: at },
    { audit: false, history: false },
  );
}

async function writeEntity(
  ctx: Ctx,
  type: string,
  input: Json,
  what: string,
  leadId?: string | null,
): Promise<Json> {
  const id = asString(input.id);
  if (!id) throw new Error("Every record needs a stable id.");
  const before = await snapshot(ctx, id);
  const at = now();
  const data: Json = {
    ...(before?.data ?? {}),
    ...input,
    id,
    created_at: before?.data.created_at ?? input.created_at ?? at,
    updated_at: at,
  };
  if (!("archived_at" in data)) data.archived_at = null;
  const row: DeskRow = {
    id,
    type,
    data,
    archived_at: data.archived_at ? asString(data.archived_at) : null,
    created_at: asString(data.created_at),
    updated_at: at,
  };
  await writeRow(ctx, row, { what, leadId: leadId ?? (type === "lead" ? id : null) });
  await appendLog(ctx, what, leadId ?? (type === "lead" ? id : null));
  return data;
}

async function withOperation<T>(action: string, actor: string, fn: (ctx: Ctx) => Promise<T>) {
  const opId = uid("op");
  return db.transaction(async (tx) => {
    const ctx: Ctx = {
      tx,
      opId,
      action,
      actor: actor || "You",
      snapshots: new Map<string, DeskRow | null>(),
      logIndex: 0,
      undoable: true,
    };
    const result = await fn(ctx);
    const snapshots: EntitySnapshot[] = Array.from(ctx.snapshots.entries()).map(([id, before]) => ({ id, before }));
    await tx.insert(deskOperations).values({
      id: opId,
      at: now(),
      who: actor || "You",
      action,
      snapshots,
      undoneAt: null,
      undoable: ctx.undoable ? "true" : "false",
    });
    return { ok: true, result, operation_id: opId, actor: actor || "You", at: now() };
  });
}

async function settingsFrom(ctx: Ctx): Promise<Settings> {
  const row = await readRow(ctx, "settings");
  return { ...DEFAULT_SETTINGS, ...((row?.data ?? {}) as unknown as Settings), id: "settings" };
}

async function requireRow(ctx: Ctx, id: string, type?: string): Promise<DeskRow> {
  const row = await readRow(ctx, id);
  if (!row) throw new Error(`No record found with id ${id}.`);
  if (type && row.type !== type) throw new Error(`Record ${id} is a ${row.type}, not a ${type}.`);
  return row;
}

function leadFromRow(row: DeskRow): Lead {
  return { ...(row.data as unknown as Lead), archived_at: row.archived_at };
}

async function requireLead(ctx: Ctx, rawId: unknown): Promise<Lead> {
  const id = asString(rawId ?? "");
  if (!id) throw new Error("A lead id is required.");
  return leadFromRow(await requireRow(ctx, id, "lead"));
}

function activeContacts(lead: Lead): Json[] {
  return (lead.contacts ?? []).filter((c) => !c.archived_at);
}

function activeDefects(lead: Lead): Json[] {
  return (lead.defects ?? []).filter((d) => !d.archived_at);
}

function cadenceSpecs(settings: Settings, sentAt: string) {
  const configured = (settings.cadence_days ?? DEFAULT_CADENCE).map((n) => Number(n)).filter((n) => Number.isFinite(n));
  return DEFAULT_CADENCE.map((fallback, index) => {
    const days = configured[index] ?? fallback;
    return {
      due: addDays(sentAt, days),
      what: `Follow-up ${index + 1} — ${FOLLOWUP_LABELS[index]}`,
    };
  });
}

function buildFollowups(settings: Settings, sentAt: string) {
  return cadenceSpecs(settings, sentAt).map((spec) => ({
    id: uid("fup"),
    due: spec.due,
    what: spec.what,
    done: false,
    done_at: null,
    generated: true,
  }));
}

function firstIncomplete(lead: Lead) {
  const next = (lead.followups ?? []).find((f) => !f.done && !f.archived_at && !truthy(f.stopped_by_reply));
  return next ? { text: asString(next.what), date: assertDate(next.due, "follow-up due date") } : null;
}

function armForLead(lead: Lead, settings: Settings): "A" | "B" {
  let hash = 0;
  for (const char of lead.id) hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  return hash % 100 < Math.max(0, Math.min(100, asNumber(settings.ab_split, 50))) ? "A" : "B";
}

function touchFrom(lead: Lead, args: Json, actor: string) {
  const at = assertTimestamp(args.at, "touch timestamp");
  const channel = oneOf(args.channel ?? lead.channel, CHANNELS, "channel");
  const direction = oneOf(args.direction ?? "outbound", ["inbound", "outbound"] as Direction[], "direction");
  return {
    id: uid("tch"),
    at,
    channel,
    direction,
    outcome: asString(args.outcome, "Contact logged"),
    note: asString(args.note),
    by: actor,
  };
}

function validateTrading(verdict: Verdict, proof: string, source: string) {
  if (verdict === "TRADING" && (!proof.trim() || !source.trim())) {
    throw new Error("TRADING requires non-empty proof and proof_source. Use EXISTS or UNCERTAIN otherwise.");
  }
  if (verdict === "TRADING" && source && !/^https?:\/\//i.test(source)) {
    throw new Error("proof_source must be a full http(s) URL.");
  }
}

function validateWon(lead: Lead) {
  if (lead.stage === "Won" && !(asNumber(lead.value_paid) > 0 && asString(lead.paid_at))) {
    throw new Error("A Won lead needs value_paid and paid_at. Record the money before recording the win.");
  }
}

function ensureChildIds(data: Json): Json {
  const next = clone(data);
  for (const key of ["contacts", "defects", "followups", "touches"] as const) {
    if (Array.isArray(next[key])) {
      next[key] = (next[key] as Json[]).map((child, index) => ({
        ...child,
        id: asString(child.id) || uid(`${key.slice(0, 3)}${index}`),
      }));
    }
  }
  return next;
}

function normalizedMessage(input: Json, version: number): Message {
  const subject = asString(input.subject);
  const body = asString(input.body);
  const channel = oneOf(input.channel ?? "WhatsApp", CHANNELS, "message channel");
  if (!subject || !body) throw new Error("A message needs both a subject and a body.");
  return {
    subject,
    body,
    channel,
    words: body.trim() ? body.trim().split(/\s+/).length : 0,
    version,
    generated_at: now(),
  };
}

async function duplicateMatches(tx: Tx, name: string, town: string, phone: string) {
  const rows = (await tx.select().from(deskRecords).where(eq(deskRecords.type, "lead"))).map(rowFromDb);
  const normalizedName = name.trim().toLowerCase();
  const normalizedTown = town.trim().toLowerCase();
  const normalizedPhone = phone.replace(/\D/g, "");
  return rows
    .map((row) => ({ row, lead: row.data as unknown as Lead }))
    .filter(({ lead }) => {
      const sameName = asString(lead.name).toLowerCase() === normalizedName;
      const sameTown = asString(lead.town).toLowerCase() === normalizedTown;
      const phones = (lead.contacts ?? []).flatMap((c) => [asString(c.phone), asString(c.whatsapp)]).map((p) => p.replace(/\D/g, ""));
      const samePhone = normalizedPhone.length >= 6 && phones.some((p) => p && (p === normalizedPhone || p.endsWith(normalizedPhone) || normalizedPhone.endsWith(p)));
      return (sameName && sameTown) || samePhone || (sameName && normalizedTown === "");
    })
    .map(({ row, lead }) => ({ id: row.id, name: asString(lead.name), town: asString(lead.town), archived: Boolean(row.archived_at) }));
}

async function setArchived(ctx: Ctx, type: string, rawId: unknown, archive: boolean, label: string) {
  const id = asString(rawId);
  const row = await requireRow(ctx, id, type);
  const at = now();
  await writeEntity(ctx, type, { ...row.data, id, archived_at: archive ? at : null }, `${archive ? "Archived" : "Restored"} ${label} ${id}`, type === "lead" ? id : null);
  return { id, archived_at: archive ? at : null };
}

function requireText(value: unknown, label: string): string {
  const text = asString(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

async function mutate(ctx: Ctx, name: string, args: Json): Promise<unknown> {
  const id = asString(args.id ?? args.lead_id ?? args.leadId);
  const actor = ctx.actor;

  switch (name) {
    case "create_lead": {
      const payload = ((args.payload ?? args.lead ?? args) as Json);
      const leadName = requireText(payload.name, "Business name");
      const town = requireText(payload.town, "Town");
      const verdict = oneOf(payload.verdict ?? "UNCERTAIN", VERDICTS, "verdict");
      const proof = asString(payload.proof);
      const source = asString(payload.proof_source ?? payload.source);
      validateTrading(verdict, proof, source);
      if (payload.stage && asString(payload.stage) !== "Sourced") {
        throw new Error("New leads start at Sourced. Use the evidence-based stage actions afterwards.");
      }
      const newId = asString(payload.id) || uid("lead");
      if (await readRow(ctx, newId)) throw new Error(`ID ${newId} already exists. IDs are immutable.`);
      const at = now();
      const contactList = Array.isArray(payload.contacts) ? payload.contacts as Json[] : [];
      const defectList = Array.isArray(payload.defects) ? payload.defects as Json[] : [];
      const contacts = contactList.map((c) => ({
        id: asString(c.id) || uid("con"),
        name: asString(c.name),
        role: asString(c.role),
        phone: asString(c.phone),
        whatsapp: asString(c.whatsapp ?? c.phone),
        email: asString(c.email),
        is_owner: truthy(c.is_owner),
        archived_at: null,
      }));
      const defects = defectList.map((d) => ({
        id: asString(d.id) || uid("def"),
        text: asString(d.text),
        page: asString(d.page),
        found_at: assertTimestamp(d.found_at ?? at, "defect found_at"),
        archived_at: null,
      }));
      const message = payload.message ? normalizedMessage(payload.message as Json, 1) : null;
      const nextAction = payload.next_action
        ? { text: requireText((payload.next_action as Json).text, "Next action text"), date: assertDate((payload.next_action as Json).date, "Next action date") }
        : null;
      const warnings: string[] = [];
      if (defects.length === 0 && !message && !nextAction) {
        warnings.push("Bookmark only: no defects, no message and no next-action date.");
      }
      const duplicates = await duplicateMatches(ctx.tx, leadName, town, asString(payload.phone ?? contactList[0]?.phone));
      if (duplicates.length) warnings.push(`Possible duplicate of ${duplicates.map((d) => d.id).join(", ")}.`);
      const settings = await settingsFrom(ctx);
      const draft: Json = {
        id: newId,
        name: leadName,
        kind: asString(payload.kind),
        town,
        address: asString(payload.address),
        url: asString(payload.url),
        site_platform: asString(payload.site_platform),
        screenshot: asString(payload.screenshot),
        screenshot_captured_at: payload.screenshot ? assertTimestamp(payload.screenshot_captured_at, "screenshot_captured_at") : null,
        verdict,
        proof,
        proof_source: source,
        verified_at: payload.verified_at ? assertDate(payload.verified_at, "verified_at") : null,
        contacts,
        channel: oneOf(payload.channel ?? "WhatsApp", CHANNELS, "channel"),
        stage: "Sourced",
        stage_changed_at: at,
        defects,
        message,
        message_history: message ? [message] : [],
        sent: null,
        followups: [],
        next_action: nextAction,
        touches: [],
        demo: null,
        arm: null,
        reply: null,
        outcome: null,
        research: asString(payload.research),
        value_quoted: payload.value_quoted ? asNumber(payload.value_quoted) : null,
        value_paid: null,
        paid_at: null,
        tags: Array.isArray(payload.tags) ? payload.tags.map(String) : asString(payload.tags).split(",").map((t) => t.trim()).filter(Boolean),
        warnings,
        is_bookmark: warnings.some((w) => w.startsWith("Bookmark only")),
        created_at: at,
        updated_at: at,
        archived_at: null,
      };
      const result = await writeEntity(ctx, "lead", draft, `Created lead ${leadName}`, newId);
      return { id: newId, lead: result, warnings, duplicate_check: duplicates, arm: armForLead(result as unknown as Lead, settings) };
    }

    case "update_lead": {
      const lead = await requireLead(ctx, id);
      const patch = clone((args.patch ?? args) as Json);
      const reserved = ["id", "created_at", "updated_at", "archived_at", "stage", "stage_changed_at", "verdict", "proof", "proof_source", "verified_at", "contacts", "defects", "message", "message_history", "sent", "followups", "touches", "demo", "reply", "outcome", "value_paid", "paid_at", "next_action", "is_bookmark", "warnings", "arm"];
      for (const key of Object.keys(patch)) {
        if (reserved.includes(key)) delete patch[key];
      }
      if (!Object.keys(patch).length) throw new Error("No editable fields were supplied. Use the dedicated action for specialised fields.");
      if (patch.channel) patch.channel = oneOf(patch.channel, CHANNELS, "channel");
      if (patch.tags && !Array.isArray(patch.tags)) patch.tags = asString(patch.tags).split(",").map((t) => t.trim()).filter(Boolean);
      return writeEntity(ctx, "lead", { ...lead, ...patch, id }, `Updated lead fields: ${Object.keys(patch).join(", ")}`, id);
    }

    case "archive_lead":
      return setArchived(ctx, "lead", id, true, "lead");
    case "restore_lead":
      return setArchived(ctx, "lead", id, false, "lead");
    case "archive_record": {
      const row = await requireRow(ctx, id);
      return setArchived(ctx, row.type, id, true, row.type);
    }
    case "restore_record": {
      const row = await requireRow(ctx, id);
      return setArchived(ctx, row.type, id, false, row.type);
    }
    case "delete_seed_data": {
      const ids = new Set<string>();
      const ops = await ctx.tx.select().from(deskOperations);
      for (const op of ops) {
        if (op.action !== "seed_desk") continue;
        for (const item of (op.snapshots ?? []) as EntitySnapshot[]) {
          if (item.id !== "settings") ids.add(item.id);
        }
      }
      const rows = await ctx.tx.select().from(deskRecords);
      const seedPattern = /^(lead_kc_\d+|doc_\w+_\d+|test_\d+|win_\d+|com_\d+|tpl_\d+|view_\d+|log_seed_\d+)$/;
      for (const row of rows) {
        if (row.id === "settings") continue;
        const data = row.data as Json;
        if (truthy(data.seeded) || ids.has(row.id) || seedPattern.test(row.id)) ids.add(row.id);
      }
      const deleted: string[] = [];
      for (const id of ids) {
        const row = await readRow(ctx, id);
        if (!row) continue;
        await snapshot(ctx, id);
        await ctx.tx.delete(deskRecords).where(eq(deskRecords.id, id));
        deleted.push(id);
      }
      await appendLog(ctx, `Deleted ${deleted.length} seed records. undo_last restores every one of them.`);
      return { deleted_count: deleted.length, deleted, undo: "undo_last restores every deleted seed record" };
    }
    case "reset_desk": {
      const rows = await ctx.tx.select().from(deskRecords);
      const deleted: string[] = [];
      for (const row of rows) {
        if (row.id === "settings") continue;
        await snapshot(ctx, row.id);
        await ctx.tx.delete(deskRecords).where(eq(deskRecords.id, row.id));
        deleted.push(row.id);
      }
      await appendLog(ctx, `Cleared the desk: ${deleted.length} records deleted. undo_last restores the whole desk in one step.`);
      return { deleted_count: deleted.length, deleted, undo: "undo_last restores the entire desk" };
    }

    case "set_verdict": {
      const lead = await requireLead(ctx, id);
      const verdict = oneOf(args.verdict, VERDICTS, "verdict");
      const proof = asString(args.proof ?? lead.proof);
      const source = asString(args.proof_source ?? args.source ?? lead.proof_source);
      validateTrading(verdict, proof, source);
      const verifiedAt = args.verified_at ? assertDate(args.verified_at, "verified_at") : today();
      return writeEntity(ctx, "lead", { ...lead, id, verdict, proof, proof_source: source, verified_at: verifiedAt }, `Set verdict ${verdict} with proof`, id);
    }

    case "add_contact": {
      const lead = await requireLead(ctx, id);
      const contact = { id: uid("con"), name: requireText(args.name, "Contact name"), role: asString(args.role), phone: asString(args.phone), whatsapp: asString(args.whatsapp ?? args.phone), email: asString(args.email), is_owner: truthy(args.is_owner), archived_at: null };
      return writeEntity(ctx, "lead", { ...lead, id, contacts: [...(lead.contacts ?? []), contact] }, `Added contact ${contact.name}`, id);
    }
    case "update_contact": {
      const lead = await requireLead(ctx, id);
      const contactId = requireText(args.contact_id ?? args.contactId, "contact_id");
      const patch = (args.patch ?? args) as Json;
      const contacts = (lead.contacts ?? []).map((c) => asString(c.id) === contactId ? { ...c, ...patch, id: contactId } : c);
      if (!contacts.some((c) => asString(c.id) === contactId)) throw new Error(`Contact ${contactId} not found.`);
      return writeEntity(ctx, "lead", { ...lead, id, contacts }, `Updated contact ${contactId}`, id);
    }
    case "remove_contact": {
      const lead = await requireLead(ctx, id);
      const contactId = requireText(args.contact_id ?? args.contactId, "contact_id");
      const contacts = (lead.contacts ?? []).map((c) => asString(c.id) === contactId ? { ...c, archived_at: now() } : c);
      return writeEntity(ctx, "lead", { ...lead, id, contacts }, `Archived contact ${contactId}; nothing was destroyed`, id);
    }

    case "add_defect": {
      const lead = await requireLead(ctx, id);
      const item = { id: uid("def"), text: requireText(args.text, "Defect text"), page: asString(args.page), found_at: assertTimestamp(args.found_at, "found_at"), archived_at: null };
      return writeEntity(ctx, "lead", { ...lead, id, defects: [...(lead.defects ?? []), item] }, `Added defect on ${item.page || "site"}`, id);
    }
    case "update_defect": {
      const lead = await requireLead(ctx, id);
      const defectId = requireText(args.defect_id ?? args.defectId, "defect_id");
      const patch = (args.patch ?? args) as Json;
      delete patch.defect_id;
      delete patch.defectId;
      const defects = (lead.defects ?? []).map((d) => asString(d.id) === defectId ? { ...d, ...patch, id: defectId } : d);
      if (!defects.some((d) => asString(d.id) === defectId)) throw new Error(`Defect ${defectId} not found.`);
      return writeEntity(ctx, "lead", { ...lead, id, defects }, `Updated defect ${defectId}`, id);
    }
    case "remove_defect": {
      const lead = await requireLead(ctx, id);
      const defectId = requireText(args.defect_id ?? args.defectId, "defect_id");
      const defects = (lead.defects ?? []).map((d) => asString(d.id) === defectId ? { ...d, archived_at: now() } : d);
      return writeEntity(ctx, "lead", { ...lead, id, defects }, `Archived defect ${defectId}; nothing was destroyed`, id);
    }

    case "set_message": {
      const lead = await requireLead(ctx, id);
      const version = (lead.message?.version ?? lead.message_history?.length ?? 0) + 1;
      const message = normalizedMessage(args as Json, version);
      const settings = await settingsFrom(ctx);
      return writeEntity(ctx, "lead", { ...lead, id, message, message_history: [...(lead.message_history ?? []), message], arm: asString(args.arm) === "B" ? "B" : (lead.arm ?? armForLead(lead, settings)) }, `Stored message version ${version}`, id);
    }

    case "apply_template": {
      const lead = await requireLead(ctx, id);
      const templateId = requireText(args.template_id ?? args.templateId, "template_id");
      const template = (await requireRow(ctx, templateId, "template")).data;
      const owner = activeContacts(lead)[0];
      const firstDefect = activeDefects(lead)[0];
      const facts: Record<string, string> = {
        name: lead.name,
        town: lead.town,
        kind: lead.kind || "business",
        url: lead.url || "their website",
        contact: asString(owner?.name).split(" ")[0] || "there",
        defect: asString(firstDefect?.text).replace(/\.$/, "") || "a mobile usability issue",
      };
      const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_, key: string) => facts[key] ?? `{${key}}`);
      return mutate(ctx, "set_message", { id, subject: fill(asString(template.subject)), body: fill(asString(template.body)), channel: asString(template.channel) || lead.channel });
    }

    case "set_next_action": {
      const lead = await requireLead(ctx, id);
      const next = { text: requireText(args.text, "Next action text"), date: assertDate(args.date, "Next action date") };
      return writeEntity(ctx, "lead", { ...lead, id, next_action: next }, `Set next action for ${next.date}`, id);
    }
    case "complete_next_action": {
      const lead = await requireLead(ctx, id);
      const note = asString(args.note, "Next action completed");
      const followups = (lead.followups ?? []).map((f) => {
        const match = lead.next_action && asString(f.what) === lead.next_action.text && asString(f.due) === lead.next_action.date;
        return match ? { ...f, done: true, done_at: now(), note } : f;
      });
      const touch = touchFrom(lead, { channel: lead.channel, direction: "outbound", outcome: "Next action completed", note }, actor);
      const nextLead = { ...lead, id, next_action: null, followups, touches: [...(lead.touches ?? []), touch] };
      return writeEntity(ctx, "lead", nextLead, `Completed next action and logged a touch`, id);
    }

    case "set_stage": {
      const lead = await requireLead(ctx, id);
      const stage = oneOf(args.stage, STAGES, "stage");
      if (stage === "Sent") throw new Error("mark_sent is the only way a lead becomes Sent. Sending is evidence.");
      if (stage === "Replied") throw new Error("Use record_reply. A reply is evidence.");
      if (stage === "Won") throw new Error("Use record_win. A Won stage requires value_paid and paid_at.");
      if (stage === "Lost" || stage === "Parked") throw new Error("Use close_lead with a recorded reason.");
      if (stage === "Demo built" && !asString(lead.demo?.url)) throw new Error("Attach a demo URL before moving to Demo built.");
      if (stage === "Meeting" && !asString(lead.reply?.at)) throw new Error("A reply is required before a Meeting.");
      if (stage === "Sourced" && !["Sourced", "Demo built"].includes(lead.stage)) throw new Error("Cannot move an evidenced lead backwards to Sourced.");
      if (stage === "Demo built" && !["Sourced", "Demo built"].includes(lead.stage)) throw new Error("Demo built cannot come after sending without evidence.");
      return writeEntity(ctx, "lead", { ...lead, id, stage, stage_changed_at: now() }, `Moved stage to ${stage} with evidence`, id);
    }

    case "attach_demo": {
      const lead = await requireLead(ctx, id);
      const url = requireText(args.url ?? args.demo_url, "Demo URL");
      const demo = { url, built_at: assertTimestamp(args.built_at, "built_at"), sent_at: args.sent_at ? assertTimestamp(args.sent_at, "sent_at") : null };
      const updated = await writeEntity(ctx, "lead", { ...lead, id, demo }, `Attached demo ${url}`, id);
      if ((updated as unknown as Lead).stage === "Sourced") await mutate(ctx, "set_stage", { id, stage: "Demo built" });
      return updated;
    }
    case "attach_screenshot": {
      const lead = await requireLead(ctx, id);
      const source = args.file_or_url ?? args.url ?? args.data_url ?? args.screenshot;
      const screenshot = asString(typeof source === "object" && source ? (source as Json).dataUrl ?? (source as Json).url : source);
      if (!screenshot) throw new Error("A screenshot URL, data URL or file payload is required.");
      return writeEntity(ctx, "lead", { ...lead, id, screenshot, screenshot_captured_at: assertTimestamp(args.captured_at, "captured_at") }, "Attached mobile screenshot", id);
    }
    case "set_research": {
      const lead = await requireLead(ctx, id);
      return writeEntity(ctx, "lead", { ...lead, id, research: asString(args.text ?? args.research) }, "Updated research notes", id);
    }

    case "mark_sent": {
      const lead = await requireLead(ctx, id);
      if (!lead.message) throw new Error("Set a message before marking it sent.");
      if (lead.sent?.at) throw new Error("This lead already has a sent record. Log a touch for any later contact.");
      if (!["Sourced", "Demo built"].includes(lead.stage)) throw new Error(`mark_sent expects Sourced or Demo built, not ${lead.stage}.`);
      const settings = await settingsFrom(ctx);
      const channel = oneOf(args.channel ?? lead.message.channel ?? lead.channel, CHANNELS, "channel");
      const at = assertTimestamp(args.at, "sent timestamp");
      const followups = buildFollowups(settings, at);
      const touch = touchFrom(lead, { at, channel, direction: "outbound", outcome: "Sent", note: `Message version ${lead.message.version} sent by human click` }, actor);
      const next = { text: asString(followups[0].what), date: assertDate(followups[0].due, "follow-up date") };
      const nextLead = {
        ...lead,
        id,
        sent: { at, channel, by: actor },
        touches: [...(lead.touches ?? []), touch],
        followups,
        next_action: next,
        stage: "Sent",
        stage_changed_at: at,
        arm: armForLead(lead, settings),
      };
      validateWon(nextLead as unknown as Lead);
      return writeEntity(ctx, "lead", nextLead, `Marked sent; generated ${followups.length} cadence follow-ups and moved stage to Sent`, id);
    }

    case "log_touch": {
      const lead = await requireLead(ctx, id);
      const touch = touchFrom(lead, args, actor);
      return writeEntity(ctx, "lead", { ...lead, id, touches: [...(lead.touches ?? []), touch] }, `Logged ${touch.direction} ${touch.channel} touch: ${touch.outcome}`, id);
    }

    case "add_followup": {
      const lead = await requireLead(ctx, id);
      if (!lead.sent?.at) throw new Error("Follow-ups are generated at the moment of sending. Mark the lead sent first.");
      if (lead.reply?.at) throw new Error("A reply stopped the nudges. No follow-up can be due.");
      const settings = await settingsFrom(ctx);
      const specs = cadenceSpecs(settings, lead.sent.at);
      const index = args.cadence_index === undefined ? (lead.followups ?? []).length : asNumber(args.cadence_index, -1);
      if (!Number.isInteger(index) || index < 0 || index >= specs.length) throw new Error(`cadence_index must be 0, 1 or 2 for the three generated follow-ups.`);
      const expected = specs[index];
      if (args.due && assertDate(args.due, "follow-up due") !== expected.due) throw new Error("Follow-ups are generated from cadence, not typed. Expected due date " + expected.due + ".");
      if (args.what && asString(args.what) !== expected.what) throw new Error("Follow-ups are generated from cadence, not typed.");
      if ((lead.followups ?? []).some((f) => asString(f.due) === expected.due && asString(f.what) === expected.what)) throw new Error("That cadence follow-up already exists.");
      const item = { id: uid("fup"), due: expected.due, what: expected.what, done: false, done_at: null, generated: true };
      return writeEntity(ctx, "lead", { ...lead, id, followups: [...(lead.followups ?? []), item] }, `Generated cadence follow-up ${index + 1}`, id);
    }
    case "reschedule_followup": {
      const lead = await requireLead(ctx, id);
      if (lead.reply?.at) throw new Error("A reply stopped the nudges. This follow-up cannot be rescheduled.");
      const followupId = requireText(args.followup_id ?? args.followupId, "followup_id");
      const due = assertDate(args.due, "Rescheduled due date");
      const followups = (lead.followups ?? []).map((f) => asString(f.id) === followupId && !f.done ? { ...f, due, rescheduled_at: now() } : f);
      if (!followups.some((f) => asString(f.id) === followupId)) throw new Error(`Follow-up ${followupId} not found.`);
      const candidate = { ...lead, followups };
      return writeEntity(ctx, "lead", { ...candidate, id, next_action: firstIncomplete(candidate as Lead) }, `Rescheduled follow-up ${followupId} to ${due}`, id);
    }
    case "complete_followup": {
      const lead = await requireLead(ctx, id);
      const followupId = requireText(args.followup_id ?? args.followupId, "followup_id");
      const note = asString(args.note, "Follow-up completed");
      const followups = (lead.followups ?? []).map((f) => asString(f.id) === followupId ? { ...f, done: true, done_at: now(), note } : f);
      if (!followups.some((f) => asString(f.id) === followupId)) throw new Error(`Follow-up ${followupId} not found.`);
      const touch = touchFrom(lead, { channel: lead.channel, direction: "outbound", outcome: "Follow-up completed", note }, actor);
      const candidate = { ...lead, followups, touches: [...(lead.touches ?? []), touch] };
      return writeEntity(ctx, "lead", { ...candidate, id, next_action: firstIncomplete(candidate as Lead) }, `Completed follow-up ${followupId} and logged a touch`, id);
    }

    case "record_reply": {
      const lead = await requireLead(ctx, id);
      if (["Won", "Lost", "Parked"].includes(lead.stage)) throw new Error(`Cannot record a reply on a ${lead.stage.toLowerCase()} lead.`);
      const reply = {
        text: requireText(args.text, "Reply text"),
        at: assertTimestamp(args.at, "reply timestamp"),
        channel: oneOf(args.channel ?? lead.channel, CHANNELS, "channel"),
      };
      const followups = (lead.followups ?? []).map((f) => f.done ? f : { ...f, done: true, done_at: reply.at, stopped_by_reply: true, note: "Stopped by reply" });
      const touch = touchFrom(lead, { at: reply.at, channel: reply.channel, direction: "inbound", outcome: "Reply received", note: reply.text }, actor);
      const nextLead = { ...lead, id, reply, stage: "Replied", stage_changed_at: reply.at, followups, next_action: { text: "Review reply and respond", date: today() }, touches: [...(lead.touches ?? []), touch] };
      return writeEntity(ctx, "lead", nextLead, "Recorded reply; stopped every cadence nudge and moved stage to Replied", id);
    }

    case "close_lead": {
      const lead = await requireLead(ctx, id);
      if (lead.stage === "Won" || lead.stage === "Lost" || lead.stage === "Parked") throw new Error(`This lead is already ${lead.stage.toLowerCase()}.`);
      const result = oneOf(args.result, ["won", "lost", "parked"] as CloseResult[], "result");
      const reason = requireText(args.reason, "Reason");
      if (result === "won") {
        const amount = asNumber(args.value ?? args.amount ?? args.value_paid);
        if (!(amount > 0)) throw new Error("Nothing counts as a win until the money is recorded. Enter a positive amount.");
        const paidAt = assertDate(args.paid_at ?? args.date, "paid_at");
        await mutate(ctx, "record_win", { id, amount, date: paidAt, what: reason });
        return { id, result, reason, amount, paid_at: paidAt };
      }
      const followups = (lead.followups ?? []).map((f) => f.done ? f : { ...f, done: true, done_at: now(), stopped_by_reply: false, note: `Stopped: lead ${result}` });
      const outcome = { result, reason, value: args.value ? asNumber(args.value) : null, at: now() };
      return writeEntity(ctx, "lead", { ...lead, id, stage: result === "lost" ? "Lost" : "Parked", stage_changed_at: now(), outcome, next_action: null, followups }, `Closed ${result}: ${reason}`, id);
    }

    case "record_win": {
      const lead = await requireLead(ctx, id);
      const amount = asNumber(args.amount ?? args.value ?? args.value_paid);
      const date = assertDate(args.date ?? args.paid_at, "payment date");
      if (amount <= 0) throw new Error("Nothing counts as a win until the money is recorded. Amount must be greater than zero.");
      const what = asString(args.what ?? args.reason, "Payment received");
      const existingWins = await ctx.tx.select().from(deskRecords).where(eq(deskRecords.type, "win"));
      const duplicateWin = existingWins.find((w) => asString((w.data as Json).lead_id) === id && asString((w.data as Json).date) === date && asNumber((w.data as Json).amount) === amount);
      if (!duplicateWin) {
        const winId = uid("win");
        await writeEntity(ctx, "win", { id: winId, lead_id: id, what, amount, date, created_at: now(), updated_at: now(), archived_at: null }, `Recorded win payment ${amount} on ${date}`, id);
      }
      const followups = (lead.followups ?? []).map((f) => f.done ? f : { ...f, done: true, done_at: now(), note: "Stopped: money recorded" });
      const nextLead: Lead = {
        ...lead,
        id,
        stage: "Won",
        stage_changed_at: now(),
        value_paid: asNumber(lead.value_paid) + (duplicateWin ? 0 : amount),
        paid_at: date,
        value_quoted: lead.value_quoted ?? amount,
        outcome: { result: "won", reason: what, value: amount, at: now() },
        next_action: null,
        followups,
      };
      validateWon(nextLead);
      return writeEntity(ctx, "lead", nextLead, `Recorded money landed ${amount} on ${date}; moved stage to Won`, id);
    }

    case "bulk": {
      const ids = (Array.isArray(args.ids) ? args.ids : asString(args.ids).split(",")).map(String).filter(Boolean);
      const operation = requireText(args.operation, "Bulk operation");
      const allowed = ["archive_lead", "restore_lead", "set_verdict", "add_defect", "set_next_action", "log_touch", "set_research", "update_lead", "remove_defect"];
      if (!allowed.includes(operation)) throw new Error(`Bulk operation ${operation} is not enabled. Supported: ${allowed.join(", ")}.`);
      const results: { id: string; ok: boolean; result?: unknown; error?: string }[] = [];
      const operationArgs = ((args.args ?? {}) as Json);
      for (const leadId of ids) {
        try {
          const result = await mutate(ctx, operation, { ...operationArgs, id: leadId, lead_id: leadId });
          results.push({ id: leadId, ok: true, result });
        } catch (error) {
          results.push({ id: leadId, ok: false, error: error instanceof Error ? error.message : "Unknown failure" });
        }
      }
      await appendLog(ctx, `Bulk ${operation}: ${results.filter((r) => r.ok).length}/${results.length} records succeeded; one undo step covers the batch.`);
      return { operation, results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
    }

    case "documents_create": {
      const docId = asString(args.id) || uid("doc");
      return writeEntity(ctx, "document", { id: docId, kind: oneOf(args.kind ?? "operating", ["brand", "operating", "build"], "document kind"), title: requireText(args.title, "Document title"), body: asString(args.body), version: asNumber(args.version, 1), created_at: now(), updated_at: now(), archived_at: null }, `Created ${asString(args.kind, "document")} document`);
    }
    case "documents_update": {
      const doc = await requireRow(ctx, id, "document");
      const patch = clone((args.patch ?? args) as Json);
      delete patch.id;
      delete patch.created_at;
      delete patch.updated_at;
      return writeEntity(ctx, "document", { ...doc.data, ...patch, id, version: patch.version ? asNumber(patch.version) : asNumber(doc.data.version, 1) + 1 }, `Updated document to version ${patch.version ?? asNumber(doc.data.version, 1) + 1}`);
    }
    case "documents_archive":
      return setArchived(ctx, "document", id, true, "document");
    case "documents_restore":
      return setArchived(ctx, "document", id, false, "document");

    case "testimonials_add": {
      const testId = asString(args.id) || uid("test");
      return writeEntity(ctx, "testimonial", { id: testId, quote: requireText(args.quote, "Quote"), who: asString(args.who), business: asString(args.business), date: assertDate(args.date ?? today(), "testimonial date"), permission_given: truthy(args.permission_given), created_at: now(), updated_at: now(), archived_at: null }, `Added testimonial from ${asString(args.who, "unknown")}`);
    }
    case "testimonials_update": {
      const row = await requireRow(ctx, id, "testimonial");
      const patch = clone((args.patch ?? args) as Json);
      delete patch.id;
      delete patch.created_at;
      delete patch.updated_at;
      if (patch.date) patch.date = assertDate(patch.date, "testimonial date");
      return writeEntity(ctx, "testimonial", { ...row.data, ...patch, id }, `Updated testimonial ${id}`);
    }
    case "testimonials_remove":
      return setArchived(ctx, "testimonial", id, true, "testimonial");
    case "testimonials_restore":
      return setArchived(ctx, "testimonial", id, false, "testimonial");

    case "wins_add":
      return mutate(ctx, "record_win", { id, amount: args.amount, date: args.date, what: args.what });
    case "wins_remove":
      return setArchived(ctx, "win", id, true, "win");
    case "wins_restore":
      return setArchived(ctx, "win", id, false, "win");

    case "commitments_update": {
      const row = await requireRow(ctx, id, "commitment");
      const patch = clone((args.patch ?? args) as Json);
      delete patch.id;
      delete patch.created_at;
      delete patch.updated_at;
      if (patch.last_run) patch.last_run = assertDate(patch.last_run, "last_run");
      if (patch.next_run) patch.next_run = assertDate(patch.next_run, "next_run");
      return writeEntity(ctx, "commitment", { ...row.data, ...patch, id }, `Updated commitment dates for ${asString(row.data.task, id)}`);
    }
    case "commitments_add": {
      const commitmentId = asString(args.id) || uid("com");
      return writeEntity(ctx, "commitment", { id: commitmentId, task: requireText(args.task, "Task"), what: asString(args.what), cadence: asString(args.cadence, "When prompted"), last_run: args.last_run ? assertDate(args.last_run, "last_run") : null, next_run: assertDate(args.next_run ?? today(), "next_run"), owner: asString(args.owner, "You"), created_at: now(), updated_at: now(), archived_at: null }, `Created commitment ${asString(args.task)}`);
    }

    case "settings_update": {
      const row = await requireRow(ctx, "settings", "settings");
      const patch = clone((args.patch ?? args) as Json);
      delete patch.id;
      delete patch.created_at;
      delete patch.updated_at;
      if (patch.cadence_days) {
        const days = (Array.isArray(patch.cadence_days) ? patch.cadence_days : asString(patch.cadence_days).split(",")).map((n) => asNumber(n)).filter((n) => n > 0).slice(0, 3);
        if (days.length !== 3) throw new Error("cadence_days must contain exactly three positive numbers.");
        patch.cadence_days = days;
      }
      if (patch.send_windows) {
        const windows = (Array.isArray(patch.send_windows) ? patch.send_windows : asString(patch.send_windows).split(",")).map((w) => asString(w)).filter((w) => /^\d{2}:\d{2}$/.test(w)).slice(0, 8);
        if (!windows.length) throw new Error("send_windows must contain HH:mm times.");
        patch.send_windows = windows;
      }
      if (patch.channel_order) {
        const order = (Array.isArray(patch.channel_order) ? patch.channel_order : asString(patch.channel_order).split(",")).map((c) => oneOf(asString(c), CHANNELS, "channel"));
        patch.channel_order = order;
      }
      if (patch.daily_quota !== undefined) patch.daily_quota = Math.max(1, Math.round(asNumber(patch.daily_quota, 12)));
      if (patch.ab_split !== undefined) patch.ab_split = Math.max(0, Math.min(100, Math.round(asNumber(patch.ab_split, 50))));
      return writeEntity(ctx, "settings", { ...row.data, ...patch, id: "settings" }, `Updated settings: ${Object.keys(patch).join(", ")}`);
    }

    case "create_saved_view": {
      const viewId = asString(args.id) || uid("view");
      const filter = (args.filter ?? {}) as Json;
      return writeEntity(ctx, "saved_view", { id: viewId, name: requireText(args.name, "Saved view name"), filter, created_at: now(), updated_at: now(), archived_at: null }, `Saved view ${asString(args.name)}`);
    }
    case "archive_saved_view":
      return setArchived(ctx, "saved_view", id, true, "saved view");
    case "create_template": {
      const templateId = asString(args.id) || uid("tpl");
      return writeEntity(ctx, "template", { id: templateId, name: requireText(args.name, "Template name"), subject: asString(args.subject), body: asString(args.body), channel: oneOf(args.channel ?? "WhatsApp", CHANNELS, "channel"), created_at: now(), updated_at: now(), archived_at: null }, `Created template ${asString(args.name)}`);
    }
    case "update_template": {
      const row = await requireRow(ctx, id, "template");
      const patch = clone((args.patch ?? args) as Json);
      delete patch.id;
      delete patch.created_at;
      delete patch.updated_at;
      return writeEntity(ctx, "template", { ...row.data, ...patch, id }, `Updated template ${id}`);
    }

    case "undo_last": {
      const operations = await ctx.tx.select().from(deskOperations).orderBy(desc(deskOperations.at)).limit(50);
      const target = operations.find((op) => !op.undoneAt && op.undoable === "true");
      if (!target) throw new Error("There is no undoable operation left.");
      const at = now();
      const snapshots = (target.snapshots ?? []) as EntitySnapshot[];
      for (const item of snapshots) {
        if (item.before) {
          await writeRow(ctx, item.before, { what: `Undo ${target.action}: restored ${item.id}`, action: "undo_last" });
        } else {
          const current = await readRow(ctx, item.id);
          if (current) {
            await writeRow(ctx, { ...current, data: { ...current.data, archived_at: at, updated_at: at }, archived_at: at, updated_at: at }, { what: `Undo ${target.action}: archived created record ${item.id}`, action: "undo_last" });
          }
        }
      }
      await ctx.tx.update(deskOperations).set({ undoneAt: at }).where(eq(deskOperations.id, target.id));
      ctx.undoable = false;
      await appendLog(ctx, `Undid operation ${target.id} (${target.action}), including every record in the batch.`);
      return { undone_operation_id: target.id, undone_action: target.action, records_restored: snapshots.length };
    }

    default:
      throw new Error(`Unknown write function: ${name}.`);
  }
}

const READ_FUNCTIONS = new Set([
  "list_leads", "get_lead", "search", "due_between", "calendar", "stats", "history",
  "export_all", "duplicate_check", "settings_get", "documents_list", "documents_get",
  "testimonials_list", "wins_list", "commitments_list", "templates_list", "saved_views_list",
]);

function parseObject(value: unknown): Json {
  if (!value) return {};
  if (typeof value === "object") return value as Json;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed as Json : {};
  } catch {
    return {};
  }
}

function fieldValue(lead: Lead, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Json)[key] : undefined, lead);
}

function matchesFilter(lead: Lead, filter: Json): boolean {
  for (const [key, raw] of Object.entries(filter)) {
    if (raw === undefined || raw === null || raw === "" || raw === "all") continue;
    if (key === "q" || key === "search") {
      if (!searchable(lead).includes(asString(raw).toLowerCase())) return false;
    } else if (key === "archived") {
      if (Boolean(lead.archived_at) !== truthy(raw)) return false;
    } else if (key === "tag") {
      if (!(lead.tags ?? []).map(String).includes(asString(raw))) return false;
    } else if (key === "dueWithin") {
      const date = lead.next_action?.date;
      if (!date || daysBetween(today(), date) > asNumber(raw, 7)) return false;
    } else if (key === "defect_count_min") {
      if (activeDefects(lead).length < asNumber(raw)) return false;
    } else if (Array.isArray(raw)) {
      if (!raw.map(String).includes(asString(fieldValue(lead, key)))) return false;
    } else {
      const actual = fieldValue(lead, key);
      if (asString(actual).toLowerCase() !== asString(raw).toLowerCase()) return false;
    }
  }
  return true;
}

function searchable(lead: Lead): string {
  const parts = [
    lead.name, lead.town, lead.kind, lead.address, lead.research, lead.url, lead.site_platform,
    ...(lead.tags ?? []).map(String),
    ...(lead.contacts ?? []).flatMap((c) => [c.name, c.role, c.phone, c.whatsapp, c.email]),
    ...(lead.defects ?? []).flatMap((d) => [d.text, d.page]),
    ...(lead.touches ?? []).flatMap((t) => [t.note, t.outcome]),
    ...(lead.followups ?? []).map((f) => f.what),
    lead.message?.subject, lead.message?.body, lead.reply?.text,
  ];
  return parts.map((p) => asString(p)).join(" ").toLowerCase();
}

function dueItems(leads: Lead[], from: string, to: string): DueItem[] {
  const items: DueItem[] = [];
  for (const lead of leads) {
    if (lead.archived_at) continue;
    if (lead.next_action?.date) {
      const date = assertDate(lead.next_action.date, "next action date");
      if (date >= from && date <= to) {
        items.push({ lead_id: lead.id, lead_name: lead.name, town: lead.town, stage: lead.stage, kind: "next_action", item_id: `${lead.id}:next`, text: lead.next_action.text, date, overdue: date < today(), days_overdue: Math.max(0, daysBetween(date, today())) });
      }
    }
    if (!lead.reply?.at) {
      for (const followup of lead.followups ?? []) {
        if (followup.done || followup.archived_at || followup.stopped_by_reply) continue;
        const date = assertDate(followup.due, "follow-up due date");
        if (date >= from && date <= to) {
          items.push({ lead_id: lead.id, lead_name: lead.name, town: lead.town, stage: lead.stage, kind: "followup", item_id: asString(followup.id), text: asString(followup.what), date, overdue: date < today(), days_overdue: Math.max(0, daysBetween(date, today())) });
        }
      }
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.lead_name.localeCompare(b.lead_name));
}

async function runQuery(name: string, args: Json): Promise<unknown> {
  if (name === "export_all") return getDataset();
  const workspace = await loadWorkspace();
  const activeLeads = workspace.leads.filter((lead) => !lead.archived_at);
  switch (name) {
    case "list_leads": {
      const filter = parseObject(args.filter);
      const sort = asString(args.sort, "next_action");
      const page = Math.max(1, Math.round(asNumber(args.page, 1)));
      const pageSize = Math.max(1, Math.min(200, Math.round(asNumber(args.page_size ?? args.pageSize, 25))));
      const filtered = workspace.leads.filter((lead) => matchesFilter(lead, { archived: false, ...filter }));
      const sorted = [...filtered].sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "verdict") return a.verdict.localeCompare(b.verdict) || a.name.localeCompare(b.name);
        if (sort === "defect_count" || sort === "defects") return activeDefects(b).length - activeDefects(a).length || a.name.localeCompare(b.name);
        if (sort === "updated_at") return asString(b.updated_at).localeCompare(asString(a.updated_at));
        if (sort === "stage") return STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage);
        return (a.next_action?.date ?? "9999-12-31").localeCompare(b.next_action?.date ?? "9999-12-31") || a.name.localeCompare(b.name);
      });
      return { items: sorted.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, page_size: pageSize, sort };
    }
    case "get_lead": {
      const id = asString(args.id ?? args.lead_id);
      const lead = workspace.leads.find((l) => l.id === id);
      if (!lead) throw new Error(`No lead found with id ${id}.`);
      return { ...lead, history: workspace.history.filter((h) => h.record_id === id) };
    }
    case "search": {
      const q = asString(args.q ?? args.query).toLowerCase();
      if (!q) return [];
      return activeLeads.filter((lead) => searchable(lead).includes(q)).slice(0, 100).map((lead) => ({ id: lead.id, name: lead.name, town: lead.town, kind: lead.kind, stage: lead.stage, verdict: lead.verdict }));
    }
    case "due_between": {
      const from = args.from ? assertDate(args.from, "from") : "1900-01-01";
      const to = args.to ? assertDate(args.to, "to") : today();
      return dueItems(activeLeads, from, to);
    }
    case "calendar": {
      const from = args.from ? assertDate(args.from, "from") : addDays(today(), -31);
      const to = args.to ? assertDate(args.to, "to") : addDays(today(), 31);
      const grouped: Record<string, DueItem[]> = {};
      for (const item of dueItems(activeLeads, from, to)) (grouped[item.date] ??= []).push(item);
      return grouped;
    }
    case "stats": {
      const range = asString(args.range ?? "all");
      const from = range === "7d" ? addDays(today(), -7) : range === "30d" ? addDays(today(), -30) : "1900-01-01";
      const within = (value: unknown) => asString(value).slice(0, 10) >= from && asString(value).slice(0, 10) <= today();
      const won = activeLeads.filter((l) => l.stage === "Won" && asNumber(l.value_paid) > 0 && asString(l.paid_at) && within(l.paid_at));
      return {
        range,
        sent: activeLeads.filter((l) => l.sent?.at && within(l.sent.at)).length,
        replied: activeLeads.filter((l) => l.reply?.at && within(l.reply.at)).length,
        demos_live: activeLeads.filter((l) => asString(l.demo?.url)).length,
        won: won.length,
        won_value: won.reduce((sum, l) => sum + asNumber(l.value_paid), 0),
        due_today: dueItems(activeLeads, "1900-01-01", today()).length,
        active_leads: activeLeads.length,
      };
    }
    case "history": {
      const recordId = asString(args.record_id ?? args.id);
      return workspace.history.filter((h) => h.record_id === recordId).sort((a, b) => b.at.localeCompare(a.at));
    }
    case "duplicate_check":
      return duplicateMatches(db as unknown as Tx, asString(args.name), asString(args.town), asString(args.phone));
    case "settings_get":
      return workspace.settings;
    case "documents_list":
      return workspace.documents;
    case "documents_get": {
      const found = workspace.documents.find((d) => d.id === asString(args.id));
      if (!found) throw new Error(`No document found with id ${asString(args.id)}.`);
      return found;
    }
    case "testimonials_list":
      return workspace.testimonials;
    case "wins_list":
      return workspace.wins;
    case "commitments_list":
      return workspace.commitments;
    case "templates_list":
      return workspace.templates;
    case "saved_views_list":
      return workspace.saved_views;
    default:
      throw new Error(`Unknown read function: ${name}.`);
  }
}

export async function executeFunction(rawName: string, args: Json, actor: string): Promise<unknown> {
  const name = rawName.replace(/\./g, "_");
  if (READ_FUNCTIONS.has(name)) return { ok: true, result: await runQuery(name, args), operation_id: null, actor };
  return withOperation(name, actor || "You", (ctx) => mutate(ctx, name, args));
}

export async function ensureSeed(): Promise<void> {
  const existing = await db.select({ id: deskRecords.id }).from(deskRecords).where(eq(deskRecords.id, "settings")).limit(1);
  if (existing.length) return;
  await withOperation("seed_desk", "System", async (ctx) => {
    for (const item of makeSeedRecords()) {
      await writeEntity(ctx, item.type, item.data, `Seeded ${item.type} ${asString(item.data.id)}`, item.type === "lead" ? asString(item.data.id) : null);
    }
    return true;
  });
}

export async function loadWorkspace(): Promise<Workspace> {
  await ensureSeed();
  const rawRows = await db.select().from(deskRecords).orderBy(desc(deskRecords.createdAt));
  const rows = rawRows.map(rowFromDb);
  const rawAudit = await db.select().from(auditEntries).orderBy(desc(auditEntries.at));
  const rawHistory = await db.select().from(historyEntries).orderBy(desc(historyEntries.at));
  const rawOperations = await db.select().from(deskOperations).orderBy(desc(deskOperations.at));
  const audit = rawAudit.map((a) => ({ id: a.id, at: a.at, who: a.who, action: a.action, entity: a.entity, entity_id: a.entityId, lead_id: a.leadId, what: a.what, changes: a.changes, operation_id: a.operationId }));
  const history: HistoryEntry[] = rawHistory.map((h) => ({ id: h.id, at: h.at, who: h.who, action: h.action, record_id: h.recordId, field: h.field, old_value: h.oldValue, new_value: h.newValue, operation_id: h.operationId }));
  const operations: Operation[] = rawOperations.map((o) => ({ id: o.id, at: o.at, who: o.who, action: o.action, snapshots: o.snapshots ?? [], undone_at: o.undoneAt, undoable: o.undoable }));
  const byType = (type: string) => rows.filter((r) => r.type === type).map((r) => ({ ...r.data, archived_at: r.archived_at } as BaseRecord));
  const settingsRow = rows.find((r) => r.id === "settings");
  return {
    schema: SCHEMA,
    generated_at: now(),
    records: rows,
    leads: byType("lead").filter((r) => !r.archived_at) as unknown as Lead[],
    documents: byType("document").filter((r) => !r.archived_at),
    testimonials: byType("testimonial").filter((r) => !r.archived_at),
    wins: byType("win").filter((r) => !r.archived_at),
    commitments: byType("commitment").filter((r) => !r.archived_at),
    templates: byType("template").filter((r) => !r.archived_at),
    saved_views: byType("saved_view").filter((r) => !r.archived_at),
    log: byType("log"),
    audit,
    history,
    operations,
    settings: { ...DEFAULT_SETTINGS, ...((settingsRow?.data ?? {}) as unknown as Settings), id: "settings" },
    trash: rows.filter((r) => Boolean(r.archived_at)),
  };
}

export async function getDataset(): Promise<Json> {
  const workspace = await loadWorkspace();
  return {
    schema: SCHEMA,
    exported_at: now(),
    leads: workspace.records.filter((r) => r.type === "lead").map((r) => r.data),
    documents: workspace.records.filter((r) => r.type === "document").map((r) => r.data),
    testimonials: workspace.records.filter((r) => r.type === "testimonial").map((r) => r.data),
    wins: workspace.records.filter((r) => r.type === "win").map((r) => r.data),
    commitments: workspace.records.filter((r) => r.type === "commitment").map((r) => r.data),
    templates: workspace.records.filter((r) => r.type === "template").map((r) => r.data),
    saved_views: workspace.records.filter((r) => r.type === "saved_view").map((r) => r.data),
    log: workspace.log,
    audit: workspace.audit,
    history: workspace.history,
    operations: workspace.operations,
    settings: workspace.settings,
    records: workspace.records,
    trash: workspace.trash,
  };
}

function incomingItems(payload: Json): { type: string; data: Json }[] {
  const items: { type: string; data: Json }[] = [];
  if (Array.isArray(payload.records)) {
    for (const row of payload.records as Json[]) {
      if (asString(row.id) && asString(row.type)) items.push({ type: asString(row.type), data: (row.data ?? row) as Json });
    }
    return items;
  }
  const map: Record<string, string> = {
    leads: "lead", documents: "document", testimonials: "testimonial", wins: "win",
    commitments: "commitment", templates: "template", saved_views: "saved_view", log: "log",
  };
  for (const [key, type] of Object.entries(map)) {
    if (Array.isArray(payload[key])) {
      for (const item of payload[key] as Json[]) {
        if (asString(item.id)) items.push({ type, data: item });
      }
    }
  }
  if (payload.settings && typeof payload.settings === "object") items.push({ type: "settings", data: { ...(payload.settings as Json), id: "settings" } });
  return items;
}

function validateImport(type: string, data: Json): string | null {
  if (type !== "lead") return null;
  const lead = data as unknown as Lead;
  if (lead.verdict === "TRADING" && (!asString(lead.proof) || !asString(lead.proof_source))) return "TRADING requires proof and proof_source";
  if (lead.stage === "Won" && !(asNumber(lead.value_paid) > 0 && asString(lead.paid_at))) return "Won requires value_paid and paid_at";
  if (lead.stage === "Sent" && !asString(lead.sent?.at)) return "Sent requires a sent.at evidence stamp";
  if (lead.stage === "Replied" && !asString(lead.reply?.at)) return "Replied requires a reply.at evidence stamp";
  if (lead.reply?.at && (lead.followups ?? []).some((f) => !f.done && !f.stopped_by_reply)) return "A reply must stop all incomplete follow-ups";
  return null;
}

export async function importDataset(payload: Json, actor: string) {
  await ensureSeed();
  const items = incomingItems(payload);
  if (!items.length) throw new Error("No importable records found. Expected a lead-desk/1 JSON export.");
  const report = { schema: payload.schema ? asString(payload.schema) : "unknown", imported_at: now(), created: [] as Json[], updated: [] as Json[], skipped: [] as Json[], conflicted: [] as Json[] };
  return withOperation("import_merge", actor || "You", async (ctx) => {
    for (const item of items) {
      const id = asString(item.data.id);
      const before = await readRow(ctx, id);
      const prepared = ensureChildIds(item.data);
      const incomingUpdatedAt = asString(prepared.updated_at);
      const conflictReason = validateImport(item.type, prepared);
      if (!id || !incomingUpdatedAt) {
        report.conflicted.push({ id, reason: "Missing stable id or updated_at; skipped" });
        continue;
      }
      if (conflictReason) {
        report.conflicted.push({ id, reason: conflictReason });
        continue;
      }
      if (!before) {
        await writeEntity(ctx, item.type, prepared, `Imported new ${item.type} ${id} (merge by id)`, item.type === "lead" ? id : asString(prepared.lead_id) || null);
        report.created.push({ id, type: item.type });
      } else if (JSON.stringify(before.data) === JSON.stringify(prepared)) {
        report.skipped.push({ id, reason: "Identical record already exists" });
      } else if (incomingUpdatedAt > asString(before.data.updated_at)) {
        const merged: Json = { ...before.data, ...prepared, id, created_at: before.data.created_at, updated_at: now() };
        await writeEntity(ctx, item.type, merged, `Merged newer imported ${item.type} ${id}; local record preserved`, item.type === "lead" ? id : asString(merged.lead_id) || null);
        report.updated.push({ id, type: item.type, incoming_updated_at: incomingUpdatedAt });
      } else {
        report.conflicted.push({ id, reason: "Local record is newer; kept local" });
      }
    }
    await appendLog(ctx, `Import merge: ${report.created.length} created, ${report.updated.length} updated, ${report.skipped.length} skipped, ${report.conflicted.length} conflicted. Nothing was replaced wholesale.`);
    return report;
  });
}
