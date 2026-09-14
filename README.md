# Quadrant

A placement agency CRM: a shared pipeline of client leads, each with its own
contacts and a full notes/activity history, with real per-person logins and
an admin role.

This is a self-hosted app — a small Node.js backend (with its own database)
plus the web page your team uses in a browser. Unlike the previous
Claude-artifact version, it has real authentication: everyone gets their own
username and password, and only admins can delete leads or manage accounts.

## What's inside

```
quadrant-app/
  src/            the backend (Express API + SQLite database)
  public/         the web app your team opens in a browser
  .env.example    settings you copy to .env and fill in
```

There's no separate database server to install — it uses SQLite, a single
file (`data/quadrant.db`) that's created automatically the first time you
run the app.

## Running it locally

You'll need [Node.js](https://nodejs.org) 18 or newer installed.

1. Install dependencies:
   ```
   npm install
   ```
2. Copy the example settings file and edit it:
   ```
   cp .env.example .env
   ```
   Open `.env` and set:
   - `JWT_SECRET` — a long random string (this is what secures everyone's login).
     Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
     and paste the result in.
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD` — the first admin account. This is
     only used the very first time the app starts with an empty database.
3. Start the server:
   ```
   npm start
   ```
4. Open `http://localhost:3000` in your browser and sign in with the admin
   username/password you set. From there, use the people icon (top right) to
   add an account for each sales rep — everyone gets their own username and
   password.

Change the admin password after your first login (there's no in-app screen
for that yet for your own account beyond an admin resetting anyone's
password from the Team & access panel — resetting your own works the same
way).

## Welcome emails

When an admin adds a new person (or gives their email address) and resets
their password, Quadrant can email them their username and password
automatically, so you don't have to relay it yourself. This is optional —
leave it unset and everything still works, you'll just share the password
another way.

To turn it on, set these in `.env` (see the commented block in
`.env.example`):

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` — your
  outgoing mail server's settings.
- `SMTP_FROM` — optional, what recipients see as the sender (defaults to
  `SMTP_USER`).
- `APP_URL` — optional, your app's web address, included as a link in the
  email.

Where to get these:

- **Gmail**: turn on 2-Step Verification on the sending account, then create
  an "app password" at <https://myaccount.google.com/apppasswords> — use
  that as `SMTP_PASS` (not the regular account password). Use
  `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`.
- **Office 365 / Outlook**: `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`,
  `SMTP_SECURE=false`, and your normal mailbox username/password (or an app
  password, if your organization requires one).
- **A company mail server**: ask whoever manages it for the host and port,
  and whether it needs SSL (`SMTP_PORT=465`, `SMTP_SECURE=true`) or STARTTLS
  (`SMTP_PORT=587`, `SMTP_SECURE=false`).

A few notes:

- The email includes the person's plain-text password, so only send it to
  an address you trust belongs to that person.
- If sending fails (bad credentials, network hiccup, or SMTP just isn't
  configured), the account is still created/updated — Quadrant tells the
  admin in the Team & access panel that they'll need to share the password
  another way, rather than failing the whole request.
- Someone added without an email address never gets an email — you'll need
  to share their login with them directly.
- Remember to add these same `SMTP_*`/`APP_URL` variables to your hosting
  provider's environment settings too (see "Deploying it somewhere your
  team can reach" below) — they only take effect where they're set.

## Roles

- **Rep** — full use of the CRM: add and edit leads, manage contacts, log
  notes and calls, move leads through the pipeline.
- **Admin** — everything a rep can do, plus deleting leads and managing
  everyone's accounts (adding people, changing roles, deactivating accounts,
  resetting passwords) from the people icon in the top bar.

There must always be at least one active admin — the app won't let you
demote or deactivate the last one.

## Deploying it somewhere your team can reach

This is a standard Node.js web app, so it runs on almost any Node hosting
service (Render, Railway, Fly.io, a plain VPS, etc.). In broad strokes:

1. Push this project to a Git repository (or upload the files directly if
   your host supports that).
2. Set the same environment variables from `.env.example` in your host's
   dashboard — **do not commit your real `.env` file**, especially
   `JWT_SECRET` and `ADMIN_PASSWORD`.
3. Set the start command to `npm install && npm start` (some hosts split
   this into a build step and a start step).
4. Make sure whatever storage your host gives the app is **persistent**
   across deploys/restarts — the SQLite file at `DATABASE_FILE` (default
   `./data/quadrant.db`) needs to survive, or your leads and accounts will
   reset. Many "serverless" or ephemeral-filesystem hosts do NOT persist
   local files — check for this before you pick a host, or point
   `DATABASE_FILE` at a persistent disk / volume the host provides.
5. Once it's live, share the URL with your team.

A couple of things worth knowing:

- **Backups**: since everything lives in one SQLite file, backing up is as
  simple as copying `data/quadrant.db` somewhere safe on a schedule.
- **HTTPS**: run this behind whatever TLS/HTTPS your host provides (almost
  all of them do this for you automatically) — passwords are sent to the
  login endpoint and should never travel over plain HTTP on the open
  internet.
- **Real-time-ish updates**: reps see each other's changes automatically —
  the app checks for updates every few seconds rather than instantly. That
  keeps the backend simple; if you want true instant updates later, that
  would mean adding WebSocket support.

## API overview (for whoever maintains this)

All endpoints are under `/api` and (other than `/api/auth/login` and
`/api/health`) require an `Authorization: Bearer <token>` header, obtained
from `/api/auth/login`.

| Method & path | Who | What |
|---|---|---|
| POST `/api/auth/login` | anyone | sign in, returns a token |
| GET `/api/auth/me` | signed in | current user |
| POST `/api/auth/change-password` | signed in | change your own password |
| GET `/api/users` | signed in | list teammates (no passwords) |
| POST `/api/users` | admin | create an account |
| PATCH `/api/users/:id` | admin | change name/role/active/password |
| GET `/api/leads` | signed in | list all leads |
| POST `/api/leads` | signed in | create a lead |
| GET `/api/leads/:id` | signed in | one lead + its contacts + notes |
| PATCH `/api/leads/:id` | signed in | edit a lead / move its stage |
| DELETE `/api/leads/:id` | admin | delete a lead |
| POST/PATCH/DELETE `/api/leads/:id/contacts[/:contactId]` | signed in | manage a lead's contacts |
| POST `/api/leads/:id/notes` | signed in | log a note/call/email/meeting |
