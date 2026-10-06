import { relations } from "drizzle-orm";
import {
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const complaintsTable = pgTable("complaints", {
  id: serial("id").primaryKey(),
  complaintNumber: varchar("complaint_number", { length: 32 }).notNull().unique(),
  userId: varchar("user_id").notNull().references(() => usersTable.id),
  issueType: varchar("issue_type", { length: 60 }).notNull(),
  severity: varchar("severity", { length: 16 }).notNull(),
  confidence: doublePrecision("confidence").notNull().default(0.5),
  description: text("description").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  address: varchar("address", { length: 240 }).notNull(),
  imageUrl: text("image_url"),
  status: varchar("status", { length: 24 }).notNull().default("submitted"),
  authorityNotes: text("authority_notes"),
  priorityScore: integer("priority_score").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const complaintHistoryTable = pgTable("complaint_status_history", {
  id: serial("id").primaryKey(),
  complaintId: integer("complaint_id").notNull().references(() => complaintsTable.id, { onDelete: "cascade" }),
  oldStatus: varchar("old_status", { length: 24 }),
  newStatus: varchar("new_status", { length: 24 }).notNull(),
  changedBy: varchar("changed_by").notNull().references(() => usersTable.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const complaintRelations = relations(complaintsTable, ({ one, many }) => ({
  reporter: one(usersTable, { fields: [complaintsTable.userId], references: [usersTable.id] }),
  history: many(complaintHistoryTable),
}));

export const complaintHistoryRelations = relations(complaintHistoryTable, ({ one }) => ({
  complaint: one(complaintsTable, { fields: [complaintHistoryTable.complaintId], references: [complaintsTable.id] }),
  changedByUser: one(usersTable, { fields: [complaintHistoryTable.changedBy], references: [usersTable.id] }),
}));
