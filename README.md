# Wedding Table Planner

A polished, practical wedding seating planner built for the whole event workflow — from RSVP collection to table assignments, staff lookup, and day-of operations.

It is designed to stay **simple enough to use under pressure** while still being **visual, elegant, and operationally useful**.

---

## Why this project exists

Most wedding planning tools are either:
- too generic,
- too bloated,
- or not built for the actual moment when people need to place guests, adjust tables, handle dietary constraints, and answer staff questions quickly.

**Wedding Table Planner** focuses on the part that gets stressful in real life:
- who is coming,
- where everyone sits,
- what the team needs to know,
- and how to keep the whole thing manageable.

---

## What it does

### Guest RSVP flow
- collect RSVP responses from guests,
- capture attendance,
- track adults / children,
- store dietary restrictions, allergies, and optional messages.

### Admin seating workflow
- manage guests and tables from a central admin view,
- assign and move guests quickly,
- import guests from CSV,
- export plan data,
- update guest details and staff notes.

### Visual seating plan
- work on a visual room/table layout,
- drag guests around between tables,
- maintain a readable seating overview,
- sync layout decisions with the admin plan.

### Staff + day-of views
- look up a guest and find their table fast,
- use a simpler mobile-friendly view for staff,
- access a cleaner operational view for the wedding day,
- print a usable summary when needed.

---

## Main views

| Page | Purpose |
|---|---|
| `/` or `/index.html` | RSVP page for guests |
| `/login.html` | Admin login |
| `/admin.html` | Main control panel for guests, tables, imports, exports |
| `/visual.html` | Visual seating plan |
| `/staff.html` | Fast guest lookup for staff |
| `/day-of.html` | Operational day-of view |

---

## Highlights

- RSVP intake
- seating plan management
- visual table layout
- guest metadata (diet, notes, phone, status)
- import/export workflow
- staff lookup page
- printable day-of page
- light / dark / system theme support

---

## Quick start

### Local

```bash
cd wedding-table-planner
npm install
node server.js
```

Then open:

- `http://localhost:8090/`
- `http://localhost:8090/login.html`

### Docker

```bash
docker compose up -d --build
```

Then open:

- `http://<your-server>:8090/`
- `http://<your-server>:8090/login.html`

---

## Default admin credentials

By default, the app warns when insecure defaults are still in use.

Important environment variables:

- `ADMIN_USER`
- `ADMIN_PASS`
- `SESSION_SECRET`

If you expose this app beyond local/private usage, **change them immediately**.

---

## Import / export

### CSV import
Accepted formats include:

- `prenom,nom,type`
- `first_name,last_name,type`
- `name,type`

Supported guest types:
- `adulte`
- `enfant`
- `bebe`

### Full config export/import
The admin panel supports complete export/import for:
- RSVP data
- plan data
- table assignments
- layout state

### Catering export
A CSV export is available for catering-oriented workflows, including:
- table grouping,
- guest types,
- totals,
- dietary information.

---

## Tech stack

- **Node.js**
- **Express**
- **SQLite** via `better-sqlite3`
- **Vanilla HTML / CSS / JavaScript**
- **Docker Compose**

No heavy frontend framework, which keeps the app lightweight and easy to run almost anywhere.

---

## Project goals

This project aims to be:

- **fast to use**,
- **easy to deploy**,
- **clear under pressure**,
- **pleasant enough to trust during a real event**.

It is not trying to be a giant all-in-one wedding SaaS.
It is trying to be a focused tool that solves the seating problem well.

---

## Current direction

The project is being actively refined around:
- stronger visual polish,
- better visual hierarchy,
- tighter admin/visual synchronization,
- smoother event-day usability,
- improved GitHub and product presentation.

---

## Possible next steps

- better automatic visual audits
- stronger browser-based UI testing
- richer table layout presets
- improved mobile interactions
- photo-ready screenshots / demo assets
- guest grouping helpers (families, households, sides)

---

## Contributing

If you want to improve the project, useful areas include:
- UI polish,
- accessibility,
- browser automation/testing,
- data import/export robustness,
- operational wedding-day workflows.

---

## License

Add the license you want to use here.
