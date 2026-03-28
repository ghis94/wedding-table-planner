# Wedding Table Planner

[English version](README.en.md)

Un planificateur de tables de mariage visuel, simple à déployer, agréable à utiliser et pensé pour les vrais moments de friction : RSVP, placement des invités, contraintes alimentaires, vue staff et organisation du jour J.

L’objectif n’est pas de faire un énorme SaaS mariage générique.
L’objectif est de résoudre **très bien** le problème du plan de table, avec une interface claire et un workflow utile sur le terrain.

---

## Pourquoi ce projet existe

Dans la vraie vie, le plan de table devient vite pénible :
- qui vient vraiment,
- combien d’adultes / d’enfants,
- où placer chacun,
- comment gérer les régimes,
- comment répondre vite aux questions du staff,
- comment garder une vue propre la veille et le jour J.

**Wedding Table Planner** se concentre sur cette partie-là, avec une approche pragmatique :
- visuelle,
- simple,
- exploitable,
- et assez élégante pour ne pas ressembler à un outil bricolé.

---

## Ce que l’application permet

### RSVP invités
- collecte des réponses RSVP,
- suivi de la présence,
- gestion adultes / enfants,
- capture des allergies, régimes et messages.

### Administration du plan de table
- gestion des invités et des tables,
- placement rapide,
- import CSV,
- export du plan,
- fiches invité avec notes staff.

### Plan visuel
- vue plus graphique de la salle,
- déplacement des invités,
- travail par tables,
- synchronisation avec l’administration.

### Vue jour J et supports imprimés
- vue opérationnelle plus lisible pour le jour J,
- cartes de table imprimables,
- supports plus élégants pour l’affichage et l’organisation,
- impression possible si nécessaire.

---

## Pages principales

| Page | Usage |
|---|---|
| `/` ou `/index.html` | RSVP invités |
| `/login.html` | Connexion admin |
| `/admin.html` | Gestion centrale |
| `/visual.html` | Plan visuel |
| `/day-of.html` | Vue opérationnelle jour J |

---

## Fonctionnalités clés

- gestion RSVP
- plan de table admin
- plan visuel des tables
- fiches invité (régimes, notes, téléphone, statut)
- import CSV invités
- export traiteur CSV
- export / import complet de la configuration
- cartes de table imprimables
- vue jour J imprimable
- thèmes light / dark / system

---

## Lancement rapide

### En local

```bash
cd wedding-table-planner
npm install
node server.js
```

Puis ouvrir :

- `http://localhost:8090/`
- `http://localhost:8090/login.html`

### Avec Docker

```bash
docker compose up -d --build
```

Puis ouvrir :

- `http://<serveur>:8090/`
- `http://<serveur>:8090/login.html`

---

## Variables importantes

Le projet utilise notamment :

- `ADMIN_USER`
- `ADMIN_PASS`
- `SESSION_SECRET`

Si tu exposes l’application hors usage local/privé, **change-les immédiatement**.

---

## Import / export

### Import CSV
Formats acceptés :

- `prenom,nom,type`
- `first_name,last_name,type`
- `name,type`

Types supportés :
- `adulte`
- `enfant`
- `bebe`

### Export complet
L’admin permet d’exporter / réimporter :
- les RSVP,
- le plan,
- les placements,
- l’état de layout.

### Export traiteur
Export CSV orienté opérationnel avec :
- tables,
- invités,
- types,
- totaux,
- régimes / allergies.

---

## Stack technique

- **Node.js**
- **Express**
- **SQLite** via `better-sqlite3`
- **HTML / CSS / JavaScript vanilla**
- **Docker Compose**

Le projet reste volontairement léger : pas de framework frontend lourd, donc plus simple à lire, adapter et déployer.

---

## Direction du projet

Wedding Table Planner cherche à être :

- **rapide à prendre en main**,
- **simple à déployer**,
- **lisible sous pression**,
- **agréable à utiliser en situation réelle**.

Ce n’est pas une suite mariage tout-en-un.
C’est un outil ciblé pour le **placement des invités et l’exploitation du plan de table**.

---

## Pistes d’évolution

- audits visuels automatiques plus poussés
- tests navigateur plus riches
- presets de disposition de salle
- interactions mobiles améliorées
- gestion de groupes / familles / foyers
- captures produit plus propres pour la démo

---

## Contribution

Les contributions utiles incluent notamment :
- amélioration UX/UI,
- accessibilité,
- robustesse import/export,
- tests navigateur,
- workflows staff / jour J.

---

## Licence

Ajoute ici la licence du projet.
