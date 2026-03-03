# Wedding Table Planner

Application web **simple, rapide et complète** pour organiser ton mariage :
- RSVP invités
- plan de table admin (drag & drop)
- persistance SQLite
- import CSV invités (avec type adulte/enfant/bébé)
- vue “jour J” imprimable (avec distinction adultes/enfants/bébés)
- déploiement Docker

Repo : https://github.com/ghis94/wedding-table-planner

---

## Fonctionnalités

### Côté invités (`/index.html`)
- formulaire RSVP : nom, prénom, présence, adultes/enfants, régimes, message
- enregistrement en base SQLite via API

### Côté admin (`/admin.html`)
- accès protégé par Basic Auth
- chargement des RSVPs `Oui` + `Peut-être` (visuellement distincts)
- création de tables avec capacité
- placement par glisser-déposer
- affectation par liste déroulante (depuis la liste invités **et** directement dans chaque carte de table)
- sauvegarde du plan de table
- suppression d’un invité (pool ou table), avec suppression RSVP associée
- export JSON
- import CSV (noms invités + type `adulte` / `enfant` / `bebe`)
- export/import complet de la configuration (RSVP + plan)
- export traiteur CSV (tables, invités, types, allergies)
- sélecteur de thème UI (Classique, Modern Dark, Romance, Forest, Mariage Luxe)

### Vue opérationnelle (`/day-of.html`)
- affichage clair par table
- compteurs adultes/enfants/bébés
- format propre pour impression PDF le jour J

### Staff mobile (`/staff.html`)
- recherche instantanée d’invités
- affiche directement la table assignée + type

### Plan visuel (`/visual.html`)
- tables rondes (vue salle)
- noms des invités affichés autour des tables
- déplacement drag & drop des tables **et** des noms invités
- sauvegarde des positions dans la configuration

### Navigation
- barre de navigation ajoutée sur toutes les pages (`index`, `admin`, `staff`, `visual`, `day-of`) pour switch rapide

---

## Stack technique

- Node.js + Express
- SQLite (`better-sqlite3`)
- Frontend statique HTML/CSS/JS

---

## Lancer avec Docker (recommandé)

```bash
cd wedding-table-planner
docker compose up -d --build
```

Accès :
- RSVP invités : `http://<IP_SERVEUR>:8090/index.html`
- Admin plan : `http://<IP_SERVEUR>:8090/admin.html`
- Staff mobile : `http://<IP_SERVEUR>:8090/staff.html`
- Plan visuel : `http://<IP_SERVEUR>:8090/visual.html`
- Vue jour J : `http://<IP_SERVEUR>:8090/day-of.html`

> Astuce: si les changements ne s'affichent pas après update, faire un hard refresh (`Ctrl+F5`).

### Variables importantes (`docker-compose.yml`)

- `ADMIN_USER` : login admin
- `ADMIN_PASS` : mot de passe admin (**à changer impérativement**)
- `SESSION_SECRET` : secret de session (**obligatoire en prod**)
- `DB_PATH` : chemin SQLite (volume persistant)

---

## Lancer sans Docker

```bash
cd wedding-table-planner
npm install
ADMIN_USER=admin ADMIN_PASS=change-me PORT=8090 npm start
```

---

## Format CSV d’import

Colonnes supportées :
- `prenom,nom,type`
- ou `first_name,last_name,type`
- ou `name,type`

`type` attendu : `adulte`, `enfant` ou `bebe`.

Exemple :
```csv
prenom,nom,type
Alice,Martin,adulte
Lina,Martin,enfant
```

---

## Structure du projet

- `server.js` : API + auth + SQLite
- `index.html` : page RSVP
- `admin.html` : gestion plan de table
- `staff.html` : recherche mobile staff
- `visual.html` : plan visuel de la salle
- `day-of.html` : vue jour J
- `data/wedding.db` : base SQLite (créée automatiquement)

---

## Sécurité minimale conseillée

- changer `ADMIN_PASS`
- définir un `SESSION_SECRET` fort
- headers de sécurité activés via `helmet` côté serveur
- auth admin par session (`/login.html`) + rate-limit login
- mettre l’admin derrière Nginx Proxy Manager + HTTPS
- idéalement restreindre `/admin.html` et `/day-of.html` par IP ou auth supplémentaire

### Nginx Proxy Manager (recommandé)

Configuration type du Proxy Host :
- Domain : `tables.ton-domaine.fr`
- Forward Host/IP : IP du serveur Docker
- Forward Port : `8090`
- Websockets : ON
- Block Common Exploits : ON
- SSL : Let's Encrypt + Force SSL + HTTP/2

Recommandation d’accès :
- soit allowlist IP sur `/admin.html` et `/day-of.html`
- soit Auth supplémentaire au niveau NPM (en plus du Basic Auth applicatif)

---

## Roadmap

- export CSV par table
- multi-événements (vin d’honneur / dîner / brunch)
- login admin par session (remplacer Basic Auth)
- confirmations RSVP par email (optionnel)
