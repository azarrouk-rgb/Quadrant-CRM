const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");

const router = express.Router();

const STAGES = ["New", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"];

function serializeLead(row) {
  return {
    id: row.id,
    companyName: row.company_name,
    industry: row.industry || "",
    website: row.website || "",
    source: row.source || "",
    stage: row.stage,
    ownerId: row.owner_id,
    value: row.value,
    primaryContactName: row.primary_contact_name || "",
    lastActivityAt: row.last_activity_at,
    lastActivityText: row.last_activity_text || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function serializeContact(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    name: row.name,
    title: row.title || "",
    email: row.email || "",
    phone: row.phone || "",
    isPrimary: !!row.is_primary,
  };
}
function serializeNote(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    type: row.type,
    text: row.text,
    authorId: row.author_id,
    authorName: row.author_name || "Someone",
    createdAt: row.created_at,
  };
}

function getLeadOr404(id, res) {
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
  if (!lead) {
    res.status(404).json({ error: "Lead not found." });
    return null;
  }
  return lead;
}

function recomputePrimaryContact(leadId) {
  const contacts = db.prepare("SELECT * FROM contacts WHERE lead_id = ?").all(leadId);
  const primary = contacts.find((c) => c.is_primary) || contacts[0];
  db.prepare("UPDATE leads SET primary_contact_name = ? WHERE id = ?").run(
    primary ? primary.name : "",
    leadId
  );
}

function logNote(leadId, { type, text, authorId, authorName }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO notes (id, lead_id, type, text, author_id, author_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(uuid(), leadId, type, text, authorId || null, authorName || "Someone", now);
  db.prepare("UPDATE leads SET last_activity_at = ?, last_activity_text = ? WHERE id = ?").run(
    now,
    text.slice(0, 160),
    leadId
  );
}

// ---------- Leads ----------

router.get("/", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM leads ORDER BY updated_at DESC").all();
  res.json({ leads: rows.map(serializeLead) });
});

router.post("/", requireAuth, (req, res) => {
  const body = req.body || {};
  if (!body.companyName || !String(body.companyName).trim()) {
    return res.status(400).json({ error: "Company name is required." });
  }
  const now = new Date().toISOString();
  const lead = {
    id: uuid(),
    company_name: String(body.companyName).trim(),
    industry: body.industry || "",
    website: body.website || "",
    source: body.source || "",
    stage: "New",
    owner_id: body.ownerId || req.user.id,
    value: body.value !== undefined && body.value !== null && body.value !== "" ? Number(body.value) : null,
    primary_contact_name: body.contactName ? String(body.contactName).trim() : "",
    last_activity_at: now,
    last_activity_text: "Lead created",
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO leads (id, company_name, industry, website, source, stage, owner_id, value,
       primary_contact_name, last_activity_at, last_activity_text, created_at, updated_at)
     VALUES (@id,@company_name,@industry,@website,@source,@stage,@owner_id,@value,
       @primary_contact_name,@last_activity_at,@last_activity_text,@created_at,@updated_at)`
  ).run(lead);

  if (body.contactName && String(body.contactName).trim()) {
    db.prepare(
      `INSERT INTO contacts (id, lead_id, name, title, email, phone, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(
      uuid(),
      lead.id,
      String(body.contactName).trim(),
      body.contactTitle || "",
      body.contactEmail || "",
      body.contactPhone || ""
    );
  }
  logNote(lead.id, { type: "system", text: "Lead created", authorId: req.user.id, authorName: req.user.name });

  const fresh = db.prepare("SELECT * FROM leads WHERE id = ?").get(lead.id);
  res.status(201).json({ lead: serializeLead(fresh) });
});

router.get("/:id", requireAuth, (req, res) => {
  const lead = getLeadOr404(req.params.id, res);
  if (!lead) return;
  const contacts = db.prepare("SELECT * FROM contacts WHERE lead_id = ?").all(lead.id);
  const notes = db
    .prepare("SELECT * FROM notes WHERE lead_id = ? ORDER BY created_at DESC")
    .all(lead.id);
  res.json({
    lead: serializeLead(lead),
    contacts: contacts.map(serializeContact),
    notes: notes.map(serializeNote),
  });
});

router.patch("/:id", requireAuth, (req, res) => {
  const lead = getLeadOr404(req.params.id, res);
  if (!lead) return;
  const body = req.body || {};
  const now = new Date().toISOString();

  const next = {
    company_name: body.companyName !== undefined ? String(body.companyName).trim() || lead.company_name : lead.company_name,
    industry: body.industry !== undefined ? body.industry : lead.industry,
    website: body.website !== undefined ? body.website : lead.website,
    source: body.source !== undefined ? body.source : lead.source,
    stage: body.stage !== undefined && STAGES.includes(body.stage) ? body.stage : lead.stage,
    owner_id: body.ownerId !== undefined ? body.ownerId : lead.owner_id,
    value: body.value !== undefined ? (body.value === "" || body.value === null ? null : Number(body.value)) : lead.value,
    updated_at: now,
  };

  db.prepare(
    `UPDATE leads SET company_name=@company_name, industry=@industry, website=@website, source=@source,
       stage=@stage, owner_id=@owner_id, value=@value, updated_at=@updated_at WHERE id=@id`
  ).run({ ...next, id: lead.id });

  if (next.stage !== lead.stage) {
    logNote(lead.id, {
      type: "system",
      text: `Stage moved: ${lead.stage} → ${next.stage}`,
      authorId: req.user.id,
      authorName: req.user.name,
    });
  }

  const fresh = db.prepare("SELECT * FROM leads WHERE id = ?").get(lead.id);
  res.json({ lead: serializeLead(fresh) });
});

router.delete("/:id", requireAuth, requireAdmin, (req, res) => {
  const lead = getLeadOr404(req.params.id, res);
  if (!lead) return;
  db.prepare("DELETE FROM leads WHERE id = ?").run(lead.id); // contacts & notes cascade
  res.json({ ok: true });
});

// ---------- Contacts ----------

router.post("/:id/contacts", requireAuth, (req, res) => {
  const lead = getLeadOr404(req.params.id, res);
  if (!lead) return;
  const body = req.body || {};
  if (!body.name || !String(body.name).trim()) {
    return res.status(400).json({ error: "Contact name is required." });
  }
  const existingCount = db
    .prepare("SELECT COUNT(*) AS n FROM contacts WHERE lead_id = ?")
    .get(lead.id).n;
  const makePrimary = existingCount === 0 || !!body.isPrimary;
  if (makePrimary) {
    db.prepare("UPDATE contacts SET is_primary = 0 WHERE lead_id = ?").run(lead.id);
  }
  const contact = {
    id: uuid(),
    lead_id: lead.id,
    name: String(body.name).trim(),
    title: body.title || "",
    email: body.email || "",
    phone: body.phone || "",
    is_primary: makePrimary ? 1 : 0,
  };
  db.prepare(
    `INSERT INTO contacts (id, lead_id, name, title, email, phone, is_primary)
     VALUES (@id,@lead_id,@name,@title,@email,@phone,@is_primary)`
  ).run(contact);
  recomputePrimaryContact(lead.id);
  logNote(lead.id, {
    type: "system",
    text: `Added contact: ${contact.name}`,
    authorId: req.user.id,
    authorName: req.user.name,
  });
  res.status(201).json({ contact: serializeContact(contact) });
});

router.patch("/:id/contacts/:contactId", requireAuth, (req, res) => {
  const lead = getLeadOr404(req.params.id, res);
  if (!lead) return;
  const contact = db
    .prepare("SELECT * FROM contacts WHERE id = ? AND lead_id = ?")
    .get(req.params.contactId, lead.id);
  if (!contact) return res.status(404).json({ error: "Contact not found." });

  const body = req.body || {};
  if (body.isPrimary) {
    db.prepare("UPDATE contacts SET is_primary = 0 WHERE lead_id = ?").run(lead.id);
  }
  const next = {
    name: body.name !== undefined ? String(body.name).trim() || contact.name : contact.name,
    title: body.title !== undefined ? body.title : contact.title,
    email: body.email !== undefined ? body.email : contact.email,
    phone: body.phone !== undefined ? body.phone : contact.phone,
    is_primary: body.isPrimary !== undefined ? (body.isPrimary ? 1 : contact.is_primary) : contact.is_primary,
  };
  db.prepare(
    "UPDATE contacts SET name=@name, title=@title, email=@email, phone=@phone, is_primary=@is_primary WHERE id=@id"
  ).run({ ...next, id: contact.id });
  recomputePrimaryContact(lead.id);
  res.json({ contact: serializeContact({ ...contact, ...next }) });
});

router.delete("/:id/contacts/:contactId", requireAuth, (req, res) => {
  const lead = getLeadOr404(req.params.id, res);
  if (!lead) return;
  db.prepare("DELETE FROM contacts WHERE id = ? AND lead_id = ?").run(req.params.contactId, lead.id);
  recomputePrimaryContact(lead.id);
  res.json({ ok: true });
});

// ---------- Notes ----------

router.post("/:id/notes", requireAuth, (req, res) => {
  const lead = getLeadOr404(req.params.id, res);
  if (!lead) return;
  const body = req.body || {};
  if (!body.text || !String(body.text).trim()) {
    return res.status(400).json({ error: "Note text can't be empty." });
  }
  const type = ["note", "call", "email", "meeting"].includes(body.type) ? body.type : "note";
  const now = new Date().toISOString();
  const note = {
    id: uuid(),
    lead_id: lead.id,
    type,
    text: String(body.text).trim(),
    author_id: req.user.id,
    author_name: req.user.name,
    created_at: now,
  };
  db.prepare(
    `INSERT INTO notes (id, lead_id, type, text, author_id, author_name, created_at)
     VALUES (@id,@lead_id,@type,@text,@author_id,@author_name,@created_at)`
  ).run(note);
  db.prepare("UPDATE leads SET last_activity_at = ?, last_activity_text = ? WHERE id = ?").run(
    now,
    note.text.slice(0, 160),
    lead.id
  );
  res.status(201).json({ note: serializeNote(note) });
});

module.exports = router;
