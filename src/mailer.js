const nodemailer = require("nodemailer");

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");

let transporter = null;
let warned = false;

function isConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransporter() {
  if (!isConfigured()) {
    if (!warned) {
      // eslint-disable-next-line no-console
      console.warn(
        "\n⚠ SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing), so Quadrant won't send" +
          " account emails. New accounts still work — just share their username/password another way.\n"
      );
      warned = true;
    }
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE, // true for port 465, false for 587/25 (STARTTLS)
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/**
 * Sends a credentials email — either a first-time welcome or a password reset
 * notice. Never throws: resolves { sent: false, reason } when email isn't
 * configured or the send fails, so callers can surface that without a 500.
 */
async function sendCredentialsEmail({ type, to, name, username, password, role }) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: "not_configured" };
  if (!to) return { sent: false, reason: "no_recipient" };

  const isWelcome = type !== "reset";
  const subject = isWelcome ? "You're set up on Quadrant" : "Your Quadrant password was reset";
  const linkLine = APP_URL ? `<p style="margin:0 0 20px"><a href="${APP_URL}" style="color:#2F6F63;font-weight:600">Open Quadrant →</a></p>` : "";
  const linkLineText = APP_URL ? `Open Quadrant: ${APP_URL}\n\n` : "";
  const intro = isWelcome
    ? `You've been added to Quadrant${role === "admin" ? " as an admin" : ""} — the team's shared pipeline of client leads.`
    : "Your Quadrant password was just reset by an admin.";

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:8px">
    <div style="background:#2F6F63;color:#fff;border-radius:10px 10px 0 0;padding:18px 22px;font-weight:700;font-size:17px">Quadrant</div>
    <div style="border:1px solid #E3DED4;border-top:none;border-radius:0 0 10px 10px;padding:22px">
      <p style="margin:0 0 16px">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 16px">${escapeHtml(intro)}</p>
      <div style="background:#FBFAF7;border:1px solid #E3DED4;border-radius:8px;padding:14px 16px;margin:0 0 18px">
        <div style="font-size:12px;color:#8A928F;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Username</div>
        <div style="font-weight:700;margin-bottom:10px">${escapeHtml(username)}</div>
        <div style="font-size:12px;color:#8A928F;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${isWelcome ? "Temporary password" : "New password"}</div>
        <div style="font-weight:700;font-family:monospace">${escapeHtml(password)}</div>
      </div>
      ${linkLine}
      <p style="margin:0;color:#8A928F;font-size:13px">Please sign in and change this password soon.</p>
    </div>
  </div>`.trim();

  const text =
    `Hi ${name},\n\n${intro}\n\n` +
    `Username: ${username}\n${isWelcome ? "Temporary" : "New"} password: ${password}\n\n` +
    `${linkLineText}Please sign in and change this password soon.`;

  try {
    await t.sendMail({ from: SMTP_FROM, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to send account email:", err.message);
    return { sent: false, reason: "send_failed" };
  }
}

module.exports = { isConfigured, sendCredentialsEmail };
