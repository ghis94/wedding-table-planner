# Wedding Table Planner V2 (Streamlit)

Version séparée de `main`, pensée pour tester une interface Streamlit avec un plan visuel plus robuste.

## Objectif

- éviter les superpositions de tables ;
- garantir une disposition stable en grille ;
- afficher les places vides autour des tables ;
- itérer rapidement sur une V2 sans casser la version Node/HTML actuelle.

## Lancer localement

```bash
pip install -r requirements-streamlit.txt
streamlit run streamlit_app.py
```

## Variables utiles

- `DB_PATH` : chemin vers la base SQLite (par défaut `data/wedding.db`)

## Remarque

Cette V2 lit la base SQLite existante et n’écrit rien pour l’instant. Elle sert de base de travail séparée pour la suite.
