/**
 * Account — the tenant boundary.
 *
 * PRD §7: Account (id, auth, oauth client registration). One human operator
 * per account; multi-tenant isolation is keyed on `account_id` downstream.
 * DEV-1130 models the identity contract only — auth mechanics (web login,
 * MCP OAuth/DCR) live in their own tasks and are not modeled here.
 */
import { z } from "zod";
import { isoTimestampSchema, uuidSchema } from "./common";

export const accountSchema = z.object({
  id: uuidSchema,
  /** Login identifier (email). Auth credentials are not modeled at this layer. */
  email: z.string().email(),
  createdAt: isoTimestampSchema,
});

export type Account = z.infer<typeof accountSchema>;
