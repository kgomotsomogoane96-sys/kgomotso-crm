import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

export type EntitySnapshot = {
  id: string;
  before: {
    id: string;
    type: string;
    data: Record<string, unknown>;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
  } | null;
};

export const deskRecords = pgTable(
  "desk_records",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("desk_records_type_idx").on(table.type)],
);

export const auditEntries = pgTable(
  "desk_audit_entries",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    who: text("who").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    leadId: text("lead_id"),
    what: text("what").notNull(),
    changes: jsonb("changes").$type<Record<string, unknown>[]>().notNull(),
    operationId: text("operation_id").notNull(),
  },
  (table) => [
    index("desk_audit_entity_idx").on(table.entity, table.entityId),
    index("desk_audit_at_idx").on(table.at),
  ],
);

export const historyEntries = pgTable(
  "desk_history_entries",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    who: text("who").notNull(),
    action: text("action").notNull(),
    recordId: text("record_id").notNull(),
    field: text("field").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    operationId: text("operation_id").notNull(),
  },
  (table) => [index("desk_history_record_idx").on(table.recordId, table.at)],
);

export const deskOperations = pgTable(
  "desk_operations",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    who: text("who").notNull(),
    action: text("action").notNull(),
    snapshots: jsonb("snapshots").$type<EntitySnapshot[]>().notNull(),
    undoneAt: text("undone_at"),
    undoable: text("undoable").notNull().default("true"),
  },
  (table) => [index("desk_operations_at_idx").on(table.at)],
);
