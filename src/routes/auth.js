const express = require("express");
const db = require("../db");
const { hashPassword, verifyPassword, issueToken } = require("../auth");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Enter a username and password." });
  }
  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(String(username).trim().toLowerCase());

  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  const token = issueToken(user);
  res.json({
    token,
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
  });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post("/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(newPassword),
    user.id
  );
  res.json({ ok: true });
});

module.exports = router;
