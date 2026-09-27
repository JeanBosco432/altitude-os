# ALTITUDE Trade — BOSCOFX Final (V7.0)

Journal de trading personnel et analytics : Deriv, JustMarkets et FundedNext, gestion des trades, captures, stratégies, equity, drawdown, Profit Factor, expectancy et historique.

## Version finale UI

- Fond trader BOSCOFX intégré localement (`assets/boscofx-trader-bg.webp`).
- Interface glass/dark/or cohérente, responsive et GitHub Pages ready.
- Refonte des modales et formulaires : espacements stables, aucun champ collé à son label, focus sans chevauchement, footer sticky.
- Wizard **Nouveau trade** élargi et responsive.
- Cartes, tableaux, comptes, médias et statistiques protégés contre les débordements de texte.
- 3 comptes cœur garantis : Deriv, JustMarkets, FundedNext.
- Cache/service worker versionné en V7.0.

## Déploiement GitHub

Le dépôt contient `.github/workflows/deploy-pages.yml` pour GitHub Pages.

**Important :** `config.js` fourni reste neutre. Sur votre dépôt réel, conservez votre `config.js` déjà configuré ou utilisez votre méthode habituelle de configuration Supabase. Ne publiez jamais une clé serveur/service-role.

### Vérification locale

```bash
bash scripts/verify.sh
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080/?v=70`.

## Données

Les migrations existantes restent compatibles. Cette version est une évolution UI/UX et fonctionnelle de la branche V6.4, sans remise à zéro volontaire des données.
