# Wedding Table Planner

[Version française](README.md)

A visual wedding seating planner built for the parts that actually get stressful: RSVP handling, guest placement, dietary constraints, staff lookup, and day-of coordination.

The goal is not to become a giant all-in-one wedding SaaS.
The goal is to solve the **seating workflow really well**, with a tool that is practical, focused, and pleasant to use.

---

## Why this project exists

Real-world seating planning gets messy very quickly:
- who is actually coming,
- how many adults and children,
- where everyone should sit,
- how to handle dietary constraints,
- how staff can answer guest questions fast,
- how to keep the whole setup manageable right before the event.

**Wedding Table Planner** focuses on that exact operational layer with an approach that is:
- visual,
- simple,
- practical,
- and polished enough not to feel like a throwaway internal tool.

---

## What the app does

### Guest RSVP flow
- collect guest RSVP responses,
- track attendance,
- manage adults / children,
- store dietary restrictions, allergies, and guest messages.

### Seating plan administration
- manage guests and tables,
- assign and move guests quickly,
- import guests from CSV,
- export plan data,
- update guest records with staff notes.

### Visual seating plan
- work with a more graphical room/table layout,
- move guests visually,
- organize by table,
- keep the visual plan synchronized with admin data.

### Staff and day-of views
- look up a guest and find their table quickly,
- use a lightweight mobile-friendly staff view,
- access a cleaner operational day-of screen,
- print summaries when needed.

---

## Main pages

| Page | Purpose |
|---|---|
| `/` or `/index.html` | Guest RSVP page |
| `/login.html` | Admin login |
| `/admin.html` | Main management panel |
| `/visual.html` | Visual seating plan |
| `/staff.html` | Staff lookup view |
| `/day-of.html` | Day-of operational view |

---

## Key features

- RSVP management
- admin seating plan workflow
- visual table planner
- guest records (diet, notes, phone, status)
- CSV guest import
- catering CSV export
- full config import/export
- mobile staff lookup
- printable day-of screen
- light / dark / system themes

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

- `http://<server>:8090/`
- `http://<server>:8090/login.html`

---

## Important environment variables

The project uses, among others:

- `ADMIN_USER`
- `ADMIN_PASS`
- `SESSION_SECRET`

If you expose the app beyond local/private usage, **change them immediately**.

---

## Import / export

### CSV import
Accepted formats:

- `prenom,nom,type`
- `first_name,last_name,type`
- `name,type`

Supported types:
- `adulte`
- `enfant`
- `bebe`

### Full export
The admin can export / re-import:
- RSVP data,
- plan data,
- table assignments,
- layout state.

### Catering export
A CSV export is available for operational catering workflows, including:
- tables,
- guests,
- guest types,
- totals,
- dietary restrictions / allergies.

---

## Tech stack

- **Node.js**
- **Express**
- **SQLite** via `better-sqlite3`
- **Vanilla HTML / CSS / JavaScript**
- **Docker Compose**

The project intentionally stays lightweight: no heavy frontend framework, which makes it easier to read, adapt, and deploy.

---

## Project direction

Wedding Table Planner aims to be:

- **fast to understand**,
- **easy to deploy**,
- **clear under pressure**,
- **pleasant enough to trust during a real event**.

It is not trying to be a full wedding management suite.
It is a focused tool for the **seating and guest-placement workflow**.

---

## Possible next steps

- stronger automatic visual audits
- richer browser-based testing
- room/table layout presets
- better mobile interactions
- guest grouping helpers (families, households, sides)
- cleaner demo / showcase assets

---

## Contributing

Useful contribution areas include:
- UX/UI improvements,
- accessibility,
- browser automation,
- import/export robustness,
- staff and day-of workflows.

---

## License

Add your project license here.
