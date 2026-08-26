import express from "express";
import { one, many, run } from "../../database/index.js";
import { asyncHandler, requireAuth, requirePermission, httpError } from "../middleware.js";
import * as v from "../validate.js";

/**
 * "How are candidates and interviewers told about a scheduled interview?"
 *
 *   /api/notifications         - my in-app notifications (interviewers)
 *   /api/notifications/outbox  - the emails that should go to candidates
 *
 * There is no mail server in this project. The outbox holds exactly what
 * would be sent, HR reads it, sends it, and marks it sent. That is
 * honest about the limitation instead of pretending mail is configured.
 */
const router = express.Router();

function toJson(row) {
  return {
    id: Number(row.id),
    channel: row.channel,
    // What happened - the front end groups and labels by this.
    kind: row.kind,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    subject: row.subject,
    body: row.body,
    candidateId: row.candidate_id === null ? null : Number(row.candidate_id),
    candidateName: row.candidate_name ?? null,
    interviewId: row.interview_id === null ? null : Number(row.interview_id),
    readAt: row.read_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

const BASE =
  "SELECT n.*, c.full_name AS candidate_name FROM notifications n " +
  "LEFT JOIN candidates c ON c.id = n.candidate_id ";

// --- My in-app notifications -------------------------------------------
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await many(
      BASE +
        "WHERE n.channel = 'IN_APP' AND n.user_id = $1 " +
        "ORDER BY (n.read_at IS NOT NULL), n.created_at DESC LIMIT 100",
      [req.user.id]
    );

    const { count } = await one(
      "SELECT COUNT(*)::int AS count FROM notifications " +
        "WHERE channel = 'IN_APP' AND user_id = $1 AND read_at IS NULL",
      [req.user.id]
    );

    res.json({ notifications: rows.map(toJson), unread: count });
  })
);

router.post(
  "/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "notification id" });
    const changed = await run(
      "UPDATE notifications SET read_at = NOW() " +
        "WHERE id = $1 AND user_id = $2 AND read_at IS NULL",
      [id, req.user.id]
    );
    if (!changed) throw httpError(404, "That notification does not exist.");
    res.json({ ok: true });
  })
);

router.post(
  "/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    const updated = await run(
      "UPDATE notifications SET read_at = NOW() " +
        "WHERE channel = 'IN_APP' AND user_id = $1 AND read_at IS NULL",
      [req.user.id]
    );
    res.json({ ok: true, updated });
  })
);

// --- The candidate email outbox -----------------------------------------
router.get(
  "/outbox",
  requirePermission("outbox:view"),
  asyncHandler(async (req, res) => {
    const where = ["n.channel = 'EMAIL'"];
    const params = [];

    if (req.query.pending === "1") where.push("n.sent_at IS NULL");
    if (req.query.candidate) {
      params.push(v.id(req.query.candidate, { field: "candidate id" }));
      where.push("n.candidate_id = $" + params.length);
    }

    const rows = await many(
      BASE + "WHERE " + where.join(" AND ") + " ORDER BY n.created_at DESC LIMIT 200",
      params
    );

    const { count } = await one(
      "SELECT COUNT(*)::int AS count FROM notifications WHERE channel = 'EMAIL' AND sent_at IS NULL"
    );

    res.json({ messages: rows.map(toJson), pending: count });
  })
);

/** HR has sent the email by hand; record that so it is not sent twice. */
router.post(
  "/outbox/:id/sent",
  requirePermission("outbox:view"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "message id" });
    const changed = await run(
      "UPDATE notifications SET sent_at = NOW() WHERE id = $1 AND channel = 'EMAIL'",
      [id]
    );
    if (!changed) throw httpError(404, "That message does not exist.");
    res.json({ ok: true });
  })
);

export default router;
