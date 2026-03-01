# wedding-table-mvp

MVP local pour gérer un site de mariage avec RSVP + plan de table.

## Contenu

- `index.html` : page RSVP (invités)
- `admin.html` : page admin pour plan de table (drag & drop)

## Fonctionnalités MVP

- RSVP local (nom/prénom, présence, adultes/enfants, allergies, message)
- Gestion des invités présents
- Création de tables avec capacité
- Placement drag & drop invités -> tables
- Retrait d'un invité d'une table (clic)
- Sauvegarde locale du plan (localStorage)
- Export JSON
- Export PDF via impression navigateur

## Démarrage rapide

Option simple:
1. Ouvre `index.html` dans le navigateur
2. Ouvre `admin.html` pour organiser les tables

Option serveur local (recommandé):
```bash
cd /root/.openclaw/workspace/wedding-table-mvp
python3 -m http.server 8090
```
Puis:
- http://192.168.1.220:8090/index.html
- http://192.168.1.220:8090/admin.html

## Version Docker

### Build + run (Docker)
```bash
cd /root/.openclaw/workspace/wedding-table-mvp
docker build -t wedding-table-mvp .
docker run -d --name wedding-table-mvp -p 8090:80 wedding-table-mvp
```

### Docker Compose
```bash
cd /root/.openclaw/workspace/wedding-table-mvp
docker compose up -d --build
```

Accès:
- http://<IP_SERVEUR>:8090/index.html
- http://<IP_SERVEUR>:8090/admin.html

## Limites (version MVP)

- Données stockées localement (navigateur), pas multi-utilisateur natif
- Pas d'authentification
- Pas encore de contraintes avancées (groupes incompatibles, optimisation auto)

## Prochaine étape proposée

Passer en V2 (Next.js + Supabase) pour:
- accès sécurisé admin
- partage multi-appareils
- import/export CSV complet
- contraintes de placement avancées
