const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { hashPassword } = require("../auth");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const mailer = require("../mailer");

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email || "",
    role: u.role,
    active: !!u.active,
  };
}

// Everyone signed in can see the (non-secret) list of teammates — needed to
// show owners, authors and the rep picker on the new-lead form.
router.get("/", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at ASC").all();
  res.json({ users: rows.map(publicUser) });
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { name, username, password, role, email } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: "Name, username and password are all required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const cleanRole = role === "admin" ? "admin" : "rep";
  const cleanUsername = String(username).trim().toLowerCase();
  const cleanEmail = email ? String(email).trim() : "";

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(cleanUsername);
  if (existing) return res.status(409).json({ error: "That username is already taken." });

  const user = {
    id: uuid(),
    name: name.trim(),
    username: cleanUsername,
    email: cleanEmail,
    password_hash: hashPassword(password),
    role: cleanRole,
    active: 1,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO users (id, name, username, email, password_hash, role, active, created_at)
     VALUES (@id, @name, @username, @email, @password_hash, @role, @active, @created_at)`
  ).run(user);

  let email_status = { sent: false, reason: "no_recipient" };
  if (cleanEmail) {
    email_status = await mailer.sendCredentialsEmail({
      type: "welcome",
      to: cleanEmail,
      name: user.name,
      username: user.username,
      password,
      role: cleanRole,
    });
  }

  res.status(201).json({ user: publicUser(user), email: email_status });
});

router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });

  const { name, role, active, password, email } = req.body || {};

  // Don't let the last active admin lock everyone out (including themselves).
  const demotingOrDeactivating =
    (role && role !== "admin" && target.role === "admin") ||
    (active === false && target.active);
  if (demotingOrDeactivating && target.role === "admin") {
    const otherActiveAdmins = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND id != ?")
      .get(target.id).n;
    if (otherActiveAdmins === 0) {
      return res.status(400).json({ error: "There must always be at least one active admin." });
    }
  }

  if (password && password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const next = {
    name: name != null ? String(name).trim() : target.name,
    email: email != null ? String(email).trim() : target.email,
    role: role === "admin" || role === "rep" ? role : target.role,
    active: active != null ? (active ? 1 : 0) : target.active,
    password_hash: password ? hashPassword(password) : target.password_hash,
  };

  db.prepare(
    "UPDATE users SET name=@name, email=@email, role=@role, active=@active, password_hash=@password_hash WHERE id=@id"
  ).run({ ...next, id: target.id });

  const updated = { ...target, ...next };

  let email_status;
  if (password) {
    const recipient = next.email || target.email;
    email_status = recipient
      ? await mailer.sendCredentialsEmail({
          type: "reset",
          to: recipient,
          name: updated.name,
          username: updated.username,
          password,
          role: updated.role,
        })
      : { sent: false, reason: "no_recipient" };
  }

  res.json({ user: publicUser(updated), ...(email_status ? { email: email_status } : {}) });
});

module.exports = router;
