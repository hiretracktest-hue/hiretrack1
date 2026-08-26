import express from "express";
import { db } from "../db/index.js";
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
    id: row.id,
    channel: row.channel,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    subject: row.subject,
    body: row.body,
    candidateId: row.candidate_id,
    candidateName: row.candidate_name ?? null,
    interviewId: row.interview_id,
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
    const rows = db
      .prepare(
        BASE +
          "WHERE n.channel = 'IN_APP' AND n.user_id = ? " +
          "ORDER BY n.read_at IS NOT NULL, datetime(n.created_at) DESC LIMIT 100"
      )
      .all(req.user.id);

    const unread = db
      .prepare(
        "SELECT COUNT(*) AS total FROM notifications " +
          "WHERE channel = 'IN_APP' AND user_id = ? AND read_at IS NULL"
      )
      .get(req.user.id).total;

    res.json({ notifications: rows.map(toJson), unread });
  })
);

router.post(
  "/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "notification id" });
    const info = db
      .prepare(
        "UPDATE notifications SET read_at = datetime('now') " +
          "WHERE id = ? AND user_id = ? AND read_at IS NULL"
      )
      .run(id, req.user.id);
    if (!info.changes) throw httpError(404, "That notification does not exist.");
    res.json({ ok: true });
  })
);

router.post(
  "/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    const info = db
      .prepare(
        "UPDATE notifications SET read_at = datetime('now') " +
          "WHERE channel = 'IN_APP' AND user_id = ? AND read_at IS NULL"
      )
      .run(req.user.id);
    res.json({ ok: true, updated: info.changes });
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
      where.push("n.candidate_id = ?");
      params.push(v.id(req.query.candidate, { field: "candidate id" }));
    }

    const rows = db
      .prepare(BASE + "WHERE " + where.join(" AND ") + " ORDER BY datetime(n.created_at) DESC LIMIT 200")
      .all(...params);

    const pending = db
      .prepare("SELECT COUNT(*) AS total FROM notifications WHERE channel = 'EMAIL' AND sent_at IS NULL")
      .get().total;

    res.json({ messages: rows.map(toJson), pending });
  })
);

/** HR has sent the email by hand; record that so it is not sent twice. */
router.post(
  "/outbox/:id/sent",
  requirePermission("outbox:view"),
  asyncHandler(async (req, res) => {
    const id = v.id(req.params.id, { field: "message id" });
    const info = db
      .prepare("UPDATE notifications SET sent_at = datetime('now') WHERE id = ? AND channel = 'EMAIL'")
      .run(id);
    if (!info.changes) throw httpError(404, "That message does not exist.");
    res.json({ ok: true });
  })
);

export default router;
