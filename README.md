# 💍 Wedding Table Planner

Un outil simple, visuel et efficace pour organiser ton plan de table de mariage.

## Ce que fait l’application

- Gestion des RSVP invités
- Plan de table admin (drag & drop + affectation rapide)
- Plan visuel avec tables rondes et invités déplaçables
- Vue staff mobile (recherche invité → table)
- Vue Jour J imprimable
- Export traiteur CSV
- Import / export complet de la configuration
- Fiche invité admin (allergies, notes staff, contact, statut)

---

## Pages disponibles

- `/index.html` → RSVP invités
- `/login.html` → connexion admin
- `/admin.html` → gestion principale
- `/visual.html` → plan visuel de salle
- `/staff.html` → recherche mobile staff
- `/day-of.html` → vue opérationnelle/impression

---

## Lancement rapide (Docker)

```bash
git pull
cd wedding-table-planner
docker compose up -d --build
```

Accès :
- `http://<IP_SERVEUR>:8090/index.html`
- `http://<IP_SERVEUR>:8090/login.html`

---

## Configuration minimale

Dans `docker-compose.yml` (déjà présent) :

- `ADMIN_USER`
- `ADMIN_PASS`
- `SESSION_SECRET`

> Garde un mot de passe admin fort et un `SESSION_SECRET` unique.

---

## Import / Export

### Import CSV invités
Colonnes supportées :
- `prenom,nom,type`
- ou `first_name,last_name,type`
- ou `name,type`

Type : `adulte`, `enfant`, `bebe`.

### Export traiteur
Depuis l’admin : **Export traiteur CSV**
- tables
- invités
- types (adulte/enfant/bebe)
- allergies/régimes
- totaux par table

### Export / Import complet
Depuis l’admin :
- **Exporter config**
- **Importer config**

Inclut RSVP + plan + placement visuel.

---

## Stack

- Node.js + Express
- SQLite (`better-sqlite3`)
- Front HTML/CSS/JS
- Docker Compose

---

## Statut

Projet actif, orienté usage terrain (simple, rapide, fiable).