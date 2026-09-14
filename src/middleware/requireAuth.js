const { verifyToken } = require("../auth");
const db = require("../db");

/** Verifies the bearer token and attaches the current, still-active user to req.user. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in to continue." });

  let payload;
  try {
    payload = verifyToken(token);
  } catch (e) {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }

  const user = db.prepare("SELECT id, name, username, role, active FROM users WHERE id = ?").get(payload.sub);
  if (!user || !user.active) {
    return res.status(401).json({ error: "This account is no longer active." });
  }
  req.user = user;
  next();
}

/** Use after requireAuth to restrict a route to admins. */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Only an admin can do that." });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
