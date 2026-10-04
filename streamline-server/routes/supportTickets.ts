/**
 * Support Tickets routes — admin-only ticket management.
 *
 * requireAdmin is applied at the mount point in index.ts
 * (/api/horizon/support/tickets). Same handlers and collection
 * (supportTickets) as /api/admin/support/tickets.
 */
import adminSupportTicketsRouter from "./adminSupportTickets";

export default adminSupportTicketsRouter;
