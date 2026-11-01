// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./redfp360";
export * from "./redfp360-bank";
export * from "./redfp360-tax";
export * from "./redfp360-social-security";
export * from "./redfp360-hr";
export * from "./redfp360-payroll";
export * from "./redfp360-customer-service";
export * from "./redfp360-projects";
export * from "./redfp360-documents";
export * from "./redfp360-employment";
export * from "./redfp360-communications";
export * from "./redfp360-simulations";
export * from "./auth";