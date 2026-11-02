export type Json = Record<string, unknown>;

export type Verdict = "TRADING" | "EXISTS" | "UNCERTAIN";
export type Channel = "WhatsApp" | "Email" | "Call" | "Walk-in";
export type Stage =
  | "Sourced"
  | "Demo built"
  | "Sent"
  | "Replied"
  | "Meeting"
  | "Won"
  | "Lost"
  | "Parked";
export type Direction = "inbound" | "outbound";
export type CloseResult = "won" | "lost" | "parked";

export interface BaseRecord extends Json {
  id: string;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  [key: string]: unknown;
}

export interface Contact extends Json {
  id: string;
  name: string;
  role?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  is_owner?: boolean;
  archived_at?: string | null;
}

export interface Defect extends Json {
  id: string;
  text: string;
  found_at: string;
  page?: string;
  archived_at?: string | null;
}

export interface Message extends Json {
  subject: string;
  body: string;
  channel: Channel;
  words: number;
  version: number;
  generated_at: string;
}

export interface SentRecord extends Json {
  at: string;
  channel: Channel;
  by: string;
}

export interface Followup extends Json {
  id: string;
  due: string;
  what: string;
  done: boolean;
  done_at?: string | null;
  note?: string;
  generated?: boolean;
  stopped_by_reply?: boolean;
  archived_at?: string | null;
}

export interface NextAction extends Json {
  text: string;
  date: string;
}

export interface Touch extends Json {
  id: string;
  at: string;
  channel: Channel;
  direction: Direction;
  outcome: string;
  note?: string;
  by: string;
}

export interface Demo extends Json {
  url: string;
  built_at: string;
  sent_at?: string | null;
}

export interface Reply extends Json {
  text: string;
  at: string;
  channel: Channel;
}

export interface Outcome extends Json {
  result: CloseResult;
  reason: string;
  value?: number;
  at: string;
}

export interface Lead extends BaseRecord {
  name: string;
  kind?: string;
  town: string;
  address?: string;
  url?: string;
  site_platform?: string;
  screenshot?: string;
  screenshot_captured_at?: string;
  verdict: Verdict;
  proof: string;
  proof_source?: string;
  verified_at?: string;
  contacts: Contact[];
  channel: Channel;
  stage: Stage;
  stage_changed_at: string;
  defects: Defect[];
  message: Message | null;
  message_history: Message[];
  sent: SentRecord | null;
  followups: Followup[];
  next_action: NextAction | null;
  touches: Touch[];
  demo: Demo | null;
  arm: "A" | "B" | null;
  reply: Reply | null;
  outcome: Outcome | null;
  research: string;
  value_quoted?: number | null;
  value_paid?: number | null;
  paid_at?: string | null;
  tags: string[];
  warnings?: string[];
  is_bookmark?: boolean;
}

export interface DeskRow {
  id: string;
  type: string;
  data: Json;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry extends Json {
  id: string;
  at: string;
  who: string;
  action: string;
  entity: string;
  entity_id: string;
  lead_id?: string | null;
  what: string;
  changes: Json[];
  operation_id: string;
}

export interface HistoryEntry extends Json {
  id: string;
  at: string;
  who: string;
  action: string;
  record_id: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
  operation_id: string;
}

export interface Operation extends Json {
  id: string;
  at: string;
  who: string;
  action: string;
  snapshots: { id: string; before: DeskRow | null }[];
  undone_at: string | null;
  undoable: string;
}

export interface Settings extends BaseRecord {
  cadence_days: number[];
  send_windows: string[];
  daily_quota: number;
  ab_split: number;
  channel_order: Channel[];
  timezone_label: string;
}

export interface Workspace {
  schema: "lead-desk/1";
  generated_at: string;
  records: DeskRow[];
  leads: Lead[];
  documents: BaseRecord[];
  testimonials: BaseRecord[];
  wins: BaseRecord[];
  commitments: BaseRecord[];
  templates: BaseRecord[];
  saved_views: BaseRecord[];
  log: BaseRecord[];
  audit: AuditEntry[];
  history: HistoryEntry[];
  operations: Operation[];
  settings: Settings;
  trash: DeskRow[];
}

export interface DueItem {
  lead_id: string;
  lead_name: string;
  town: string;
  stage: Stage;
  kind: "next_action" | "followup";
  item_id: string;
  text: string;
  date: string;
  overdue: boolean;
  days_overdue: number;
}
