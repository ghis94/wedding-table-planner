# Wedding Table Planner MVP

Application web simple mais complète pour organiser un mariage:
- **RSVP invités**
- **Plan de table admin** (drag & drop)
- **Stockage SQLite**
- **Import CSV invités**
- **Vue Jour J** imprimable
- **Déploiement Docker ready**

Repo: https://github.com/ghis94/wedding-table-planner

---

## ✨ Fonctionnalités

### 1) Espace invités
- Formulaire RSVP: nom, prénom, présence, adultes/enfants, régimes, message

### 2) Espace admin (protégé)
- Auth Basic (`ADMIN_USER` / `ADMIN_PASS`)
- Chargement des RSVPs confirmés
- Création de tables + capacité
- Placement invités par glisser-déposer
- Sauvegarde du plan en base SQLite
- Export JSON

### 3) Import CSV
- Import texte CSV avec colonnes `prenom,nom` (ou `first_name,last_name`, ou `name`)

### 4) Vue Jour J
- Affichage clair par table
- Bouton imprimer (PDF via navigateur)

---

## 🧱 Stack

- Node.js + Express
- SQLite (`sqlite3`)
- Front statique HTML/CSS/JS

---

## 🚀 Lancer en Docker

```bash
cd wedding-table-mvp
docker compose up -d --build
```

Accès:
- Invités (RSVP): `http://<IP>:8090/index.html`
- Admin plan: `http://<IP>:8090/admin.html`
- Vue Jour J: `http://<IP>:8090/day-of.html`

> ⚠️ Pense à changer `ADMIN_PASS` dans `docker-compose.yml` avant prod.

---

## 🗂️ Structure

- `server.js` : API + auth + SQLite
- `index.html` : page RSVP
- `admin.html` : gestion plan de table
- `day-of.html` : vue opérationnelle jour J
- `data/wedding.db` : base SQLite (créée automatiquement)

---

## 🔜 Roadmap possible

- Export CSV par table
- Gestion multi-événements (vin d’honneur, dîner, brunch)
- Envoi automatique d’emails de confirmation RSVP
- Login admin par session (au lieu de Basic Auth)
