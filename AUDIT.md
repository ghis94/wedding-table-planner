# Audit complet - Wedding Table Planner

Date: 2026-04-28
Workspace: /data/workspace/wedding-table-planner

## Résumé exécutif

Le projet est fonctionnel et relativement simple: Express + SQLite + pages HTML/CSS/JS statiques. Les routes principales répondent, l’auth admin fonctionne, npm audit ne remonte aucune vulnérabilité connue après `npm audit fix`.

Mais il y a deux problèmes critiques avant toute exposition réelle sur le réseau:

1. `express.static(__dirname)` expose trop de fichiers, y compris:
   - `/data/wedding.db` -> base SQLite téléchargeable sans auth
   - `/server.js` -> code source téléchargeable sans auth
   - `/.git/config` -> métadonnées Git téléchargeables sans auth
   - `/package-lock.json` -> dépendances exactes téléchargeables

2. Les secrets par défaut sont encore utilisés dans le lancement actuel:
   - ADMIN_USER=admin
   - ADMIN_PASS=changeme
   - SESSION_SECRET=dev-secret

Priorité absolue: corriger l’exposition statique puis configurer de vrais secrets.

---

## État du projet

Fichiers applicatifs principaux:

- `server.js`: 805 lignes
- `admin.html`: 904 lignes
- `styles.css`: 653 lignes
- `postcards.html`: 388 lignes
- `visual.html`: 327 lignes
- `index.html`: 289 lignes
- `header.js`: 189 lignes
- `theme.js`: 99 lignes
- `day-of.html`: 79 lignes
- `login.html`: 100 lignes

Dépendances:

- Express 4.22.1
- better-sqlite3 11.10.0
- bcryptjs 2.4.3
- helmet 8.1.0
- express-session 1.18.1
- express-rate-limit 7.5.1
- csv-parse 5.6.0
- @resvg/resvg-js 2.6.2

Audit npm:

- 0 vulnérabilité connue après `npm audit fix`
- `package-lock.json` est modifié localement par le fix

Dépendances avec versions majeures plus récentes:

- express 4.22.1 -> 5.2.1
- better-sqlite3 11.10.0 -> 12.9.0
- bcryptjs 2.4.3 -> 3.0.3
- csv-parse 5.6.0 -> 6.2.1
- express-rate-limit 7.5.1 -> 8.4.1

Ne pas migrer en masse sans tests, surtout Express 5 et better-sqlite3.

---

## Vérifications runtime effectuées

Serveur actif sur 8090.

Routes testées:

- `/health` -> 200 OK
- `/admin.html` sans auth -> 302 vers login
- `/api/rsvps` sans auth -> 401
- login admin avec mauvais mot de passe -> 401
- login admin avec `changeme` -> 200
- `/api/rsvps` avec session -> 200
- `/api/plan` avec session -> 200

Fuite statique confirmée sans authentification:

- `/data/wedding.db` -> 200, contenu SQLite lisible
- `/server.js` -> 200, code source lisible
- `/.git/config` -> 200, config Git lisible
- `/package-lock.json` -> 200, lockfile lisible

---

## Problèmes critiques

### 1. Exposition de la base SQLite et du code source

Cause:

```js
app.use(express.static(__dirname));
```

Cette ligne sert tout le dossier du projet. Comme la base est dans `data/wedding.db`, elle devient accessible publiquement.

Impact:

- fuite de toutes les réponses RSVP
- fuite des téléphones, régimes, notes staff
- fuite du plan de table
- fuite du code source
- fuite potentielle des métadonnées Git

Correction recommandée:

Créer un dossier `public/` et ne servir que ce dossier:

```txt
public/
  index.html
  login.html
  admin.html
  visual.html
  day-of.html
  staff.html
  postcards.html
  styles.css
  theme.js
  header.js
```

Puis dans `server.js`:

```js
const PUBLIC_DIR = path.join(__dirname, 'public');

app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/login.html', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get(['/admin.html', '/visual.html', '/day-of.html', '/staff.html'], requireAdmin);
app.use(express.static(PUBLIC_DIR, { index: false, dotfiles: 'deny' }));
```

Et adapter les `sendFile` protégés vers `PUBLIC_DIR`.

Correction minimale si on ne déplace pas les fichiers tout de suite:

```js
app.use((req, res, next) => {
  if (
    req.path.startsWith('/data/') ||
    req.path.startsWith('/.git/') ||
    req.path === '/server.js' ||
    req.path === '/package.json' ||
    req.path === '/package-lock.json' ||
    req.path === '/docker-compose.yml' ||
    req.path === '/Dockerfile' ||
    req.path === '/.env'
  ) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(__dirname, { index: false, dotfiles: 'deny' }));
```

Mais la vraie solution reste `public/`.

### 2. Secrets par défaut / faibles

Actuellement le serveur a été lancé avec:

```bash
ADMIN_USER=admin ADMIN_PASS=changeme SESSION_SECRET=dev-secret npm start
```

Impact:

- accès admin trivial si exposé au LAN
- session falsifiable plus facilement si secret faible

Correction:

Utiliser un `.env` ou des variables Docker solides:

```bash
ADMIN_USER=ghis
ADMIN_PASS='<mot-de-passe-long-unique>'
SESSION_SECRET='<openssl rand -hex 32>'
```

À faire aussi dans `docker-compose.yml`, qui contient encore des placeholders:

```yaml
ADMIN_PASS=change-me-now
SESSION_SECRET=change...-key
```

### 3. Pas de protection CSRF

Les endpoints admin mutatifs utilisent une session cookie:

- POST `/api/plan`
- PUT `/api/rsvp/:id`
- DELETE `/api/rsvp/:id`
- POST `/api/import-csv`
- POST `/api/config/import`

Avec `sameSite: 'lax'`, le risque est réduit mais pas nul. Pour une app admin, ajouter un token CSRF est préférable.

Correction recommandée:

- générer un token de session après login
- endpoint `/auth/csrf`
- header `X-CSRF-Token` requis sur POST/PUT/DELETE

### 4. CSP désactivée

Dans Helmet:

```js
contentSecurityPolicy: false
```

C’est probablement dû aux scripts inline nombreux, mais ça laisse plus de surface XSS.

Correction:

- externaliser les scripts inline dans des fichiers JS
- supprimer les handlers inline `onclick="..."`
- activer une CSP progressive:

```js
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
  }
}
```

### 5. Erreurs serveur renvoyées au client

Beaucoup de routes font:

```js
res.status(500).json({ ok: false, error: err.message });
```

Impact:

- fuite d’informations internes
- chemins fichiers, erreurs SQLite, détails d’environnement

Correction:

Créer un helper:

```js
function serverError(res, err, context) {
  console.error(`[${context}]`, err);
  return res.status(500).json({ ok: false, error: 'Erreur serveur' });
}
```

---

## Doublons et refactorisation

### 1. Doublon majeur: thèmes cartes postales

Les thèmes de cartes existent à deux endroits:

- `server.js` lignes 124-156: `CARD_THEMES`
- `postcards.html` lignes ~103-130: classes CSS `.theme-*`
- `server.js` lignes 236-266: duplication des classes CSS `.theme-*` dans le HTML généré

Impact:

- très facile d’avoir des divergences preview/export
- maintenance pénible
- augmentation inutile de `server.js`

Refactor recommandé:

Créer un fichier partagé, par exemple:

```txt
public/card-themes.js
public/card.css
```

Ou côté serveur:

```txt
card-themes.json
card-template.css
```

Puis:

- frontend charge les thèmes depuis `/api/card-themes` ou depuis un JS partagé
- serveur réutilise le même JSON pour injecter les variables CSS
- la CSS de carte est une ressource unique, pas copiée dans `server.js`

### 2. Doublon `escapeHtml`

Fonction présente dans:

- `postcards.html`
- `visual.html`
- `day-of.html`
- `admin.html`
- `server.js`

Refactor:

Créer `public/utils.js`:

```js
window.escapeHtml = function escapeHtml(value = '') { ... };
```

Ou mieux, réduire `innerHTML` et construire avec `textContent`.

### 3. Doublons métier frontend/backend

Fonctions dupliquées:

- `normalizePresence`: `server.js` + `admin.html`
- `densityClass`: `server.js` + `postcards.html`
- `layoutClass`: `server.js` + `postcards.html`
- `renameTable`: `admin.html` + `visual.html`
- `updateStats`: `admin.html` + `visual.html`
- `typeLabel`: `visual.html` + `day-of.html`
- `load`: `postcards.html` + `visual.html` + `day-of.html`

Refactor recommandé:

- `public/domain.js`: normalisation présence/type, labels, stats
- `public/api-client.js`: wrapper fetch + auth redirect + erreurs
- `public/table-plan.js`: fonctions communes de plan/tables/invités

### 4. HTML inline trop volumineux

Lignes inline détectées:

- `admin.html`: 424 lignes JS inline + 297 lignes CSS inline
- `postcards.html`: 95 lignes JS inline + 258 lignes CSS inline
- `visual.html`: 91 lignes JS inline + 185 lignes CSS inline
- `index.html`: 36 lignes JS inline + 130 lignes CSS inline

Impact:

- CSP difficile à activer
- tests unitaires quasi impossibles
- maintenance plus difficile

Refactor:

```txt
public/css/admin.css
public/css/postcards.css
public/css/visual.css
public/js/admin.js
public/js/postcards.js
public/js/visual.js
public/js/rsvp.js
```

### 5. `server.js` fait trop de choses

`server.js` contient:

- configuration Express
- DB schema/migrations
- auth/session
- normalisation/sanitation
- API RSVP
- API plan
- import/export config
- export CSV
- génération HTML cartes
- génération ZIP manuelle
- orchestration Chromium/PDF

Refactor recommandé:

```txt
src/server.js
src/config.js
src/db.js
src/auth.js
src/routes/rsvps.js
src/routes/plan.js
src/routes/import-export.js
src/routes/postcards.js
src/services/card-renderer.js
src/services/zip.js
src/utils/sanitize.js
src/utils/csv.js
```

---

## Qualité et robustesse

### Tests absents

`package.json` ne contient que:

```json
"scripts": {
  "start": "node server.js"
}
```

Ajouter:

```json
"scripts": {
  "start": "node server.js",
  "check": "node --check server.js && node --check header.js && node --check theme.js",
  "test": "node --test",
  "audit": "npm audit"
}
```

Tests prioritaires:

1. Auth:
   - login OK/KO
   - accès `/admin.html` protégé
   - accès API protégé

2. Sécurité statique:
   - `/data/wedding.db` doit retourner 404
   - `/.git/config` doit retourner 404
   - `/server.js` doit retourner 404

3. RSVP:
   - création valide
   - rejet présence invalide
   - longueur maximale respectée

4. Plan:
   - sauvegarde/lecture
   - sanitation type invité
   - layout préservé

5. Export:
   - CSV échappe correctement les guillemets
   - config export/import roundtrip

### Base de données

État actuel:

- `rsvps`: 0 ligne
- `plan`: 1 ligne
- plan: 9 tables, 78 invités racine, 9 layouts de table
- aucun doublon de noms placés détecté dans les tables

Points à améliorer:

- ajouter `updatedAt` sur RSVP
- ajouter index sur `createdAt`
- journal mode WAL:

```js
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
```

- migrations versionnées au lieu de `ALTER TABLE` inline

### Auth/session

Actuel:

- session mémoire Express par défaut
- cookie httpOnly, sameSite lax, secure false
- maxAge 8h

Problèmes:

- MemoryStore pas idéal même pour petite prod
- session perdue au redémarrage
- pas de persistance session
- `secure: false` même derrière HTTPS

Recommandations:

- utiliser `better-sqlite3-session-store` ou `connect-sqlite3`
- `secure: process.env.NODE_ENV === 'production'`
- `proxy: true` si reverse proxy HTTPS
- forcer secrets non défaut en production:

```js
if (process.env.NODE_ENV === 'production' && ADMIN_PASS === DEFAULT_ADMIN_PASS) process.exit(1);
```

### Exports cartes/PDF

Points positifs:

- `execFileSync` utilise un chemin chromium contrôlé, pas une commande shell pour le rendu
- `safeFileName` limite les noms de fichiers
- HTML généré échappe les noms invités/tables

Points à améliorer:

- les dossiers temporaires `wtp-cards-*` et `wtp-pdf-*` ne sont jamais supprimés
- génération synchrone: bloque l’event loop pendant Chromium/ZIP/PDF
- aucun timeout explicite sur Chromium
- `format=jpg` renvoie actuellement un PNG nommé `.jpg` car Chromium génère toujours `pngPath`

Corrections:

- `try/finally fs.rmSync(tmpBase, { recursive: true, force: true })`
- passer en async `execFile` avec timeout
- si JPG demandé, convertir réellement ou supprimer l’option JPG
- limiter le nombre de tables exportables ou mettre une file de job

### Frontend / XSS

Beaucoup de `innerHTML` sont utilisés. Les textes utilisateur sont souvent passés par `escapeHtml`, c’est bien, mais le pattern reste risqué et fragile.

Zones à surveiller:

- `admin.html` rend des gros templates avec `onclick` inline
- IDs insérés dans attributs JS inline
- `theme.js` et `header.js` injectent du HTML
- CSP désactivée

Recommandation:

- remplacer progressivement par `document.createElement` + `textContent`
- utiliser `addEventListener`
- créer des helpers `el()`, `button()`, `tag()`
- interdire les scripts inline via CSP ensuite

### Import CSV / doublons invités

Actuellement, côté admin:

```js
guests=[...guests,...imported.filter(n=>!guests.some(g=>g.name===n.name && normalizeType(g.type)===normalizeType(n.type)))]
```

Problèmes:

- comparaison sensible à la casse et aux espaces
- ne tient pas compte des invités déjà placés dans les tables
- le serveur ne renvoie pas forcément `regime` malgré l’utilisation frontend
- les doublons peuvent réapparaître si nom typographiquement différent

Correction:

Créer une clé canonique:

```js
function guestKey(g) {
  return `${String(g.name||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')}::${normalizeType(g.type)}`;
}
```

Et vérifier dans tous les invités:

```js
const existingKeys = new Set(allGuestsList().map(guestKey));
const importedUnique = imported.filter(g => !existingKeys.has(guestKey(g)));
```

Mieux: faire cette déduplication côté serveur aussi.

---

## Docker / déploiement

Dockerfile:

```dockerfile
FROM node:22-alpine
RUN npm install --omit=dev
COPY . .
```

Améliorations:

- utiliser `npm ci --omit=dev` plutôt que `npm install`
- ne pas copier `.git`, `node_modules`, `data` grâce à `.dockerignore` déjà présent
- créer un utilisateur non-root
- ajouter healthcheck

Exemple:

```dockerfile
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8090/health || exit 1
CMD ["npm", "start"]
```

Docker compose:

- retirer les secrets en clair ou utiliser `.env`
- ajouter `NODE_ENV=production`
- vérifier que `data/` n’est jamais servi statiquement

---

## Plan d’amélioration recommandé

### Phase 1 - Urgent sécurité

1. Servir uniquement un dossier `public/`
2. Bloquer `/data`, `/.git`, `/server.js`, `package*.json`, Dockerfile, compose
3. Remplacer `ADMIN_PASS` et `SESSION_SECRET`
4. Forcer l’échec au démarrage en production si secrets par défaut
5. Ajouter tests de non-exposition statique

### Phase 2 - Déduplication / structure

1. Créer `public/js/utils.js`: `escapeHtml`, labels, normalisation
2. Créer `public/js/api-client.js`
3. Extraire les scripts inline de `admin.html`, `visual.html`, `postcards.html`
4. Extraire la CSS inline par page
5. Créer un modèle unique pour les thèmes/cartes

### Phase 3 - Robustesse

1. Ajouter `node --test` avec tests API
2. Ajouter CSRF
3. Ajouter store session SQLite
4. Nettoyer les dossiers temporaires d’export
5. Timeout Chromium et export async
6. Gestion d’erreurs serveur centralisée

### Phase 4 - Evolutions produit

1. Détection robuste des doublons invités à l’import
2. Vue “incohérences” plus forte:
   - doublons par clé canonique
   - invité présent à plusieurs tables
   - table sur-capacité
   - RSVP oui non placé
   - invité placé mais RSVP non
3. Sauvegarde automatique versionnée du plan
4. Export/import avec validation de schéma

---

## Quick wins concrets

À corriger en premier dans le code:

1. `server.js` ligne 801: remplacer `express.static(__dirname)`
2. `server.js` lignes 425 et 440: réactiver CSP progressivement et gérer `secure` selon environnement
3. `server.js` lignes 682/718: supprimer les répertoires temporaires en `finally`
4. `server.js` lignes 491, 511, etc.: ne plus renvoyer `err.message` au client
5. `postcards.html` + `server.js`: supprimer le doublon des thèmes
6. `admin.html`: remplacer la déduplication CSV simple par une clé canonique globale
7. `package.json`: ajouter scripts `check`, `test`, `audit`
8. `Dockerfile`: passer à `npm ci --omit=dev`, user non-root, healthcheck

---

## Conclusion

L’application est en bon état fonctionnel pour un outil interne, mais pas encore prête à être exposée même sur un LAN familial sans corriger l’exposition statique. La plus grosse dette technique est le mélange de tout dans `server.js` et les gros blocs CSS/JS inline, avec des doublons entre frontend et backend.

Le meilleur ordre d’action est:

1. sécurité statique + secrets
2. tests de régression de sécurité
3. déduplication des thèmes/utilitaires
4. extraction des fichiers frontend
5. CSRF/CSP/session store
