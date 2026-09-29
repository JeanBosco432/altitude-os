# ALTITUDE Trade V7.0.1 — GitHub Pages hotfix

- Corrige l'échec GitHub Actions `Missing: config.js`.
- `config.js` reste volontairement ignoré par Git et est généré pendant le déploiement depuis les variables/secrets GitHub.
- Le vérificateur exige désormais `config.example.js` et valide la génération de `_site/config.js` dans le workflow.

# ALTITUDE Trade V7.0 — BOSCOFX Final

## UI / UX final
- Fond BOSCOFX Bitcoin/or intégré avec overlays sombres dédiés à la lisibilité.
- Accent or cohérent, cartes glass, sidebar et topbar premium.
- Hero dashboard BOSCOFX discret.
- Modales plus larges et plus lisibles.
- Refonte du spacing global : labels, inputs, selects, textarea, badges, KPI et footers.
- Suppression des collisions visuelles : min-width, overflow, ellipsis et breakpoints renforcés.
- Wizard Nouveau trade optimisé desktop/tablette/mobile.
- Zone média plus visible et plus confortable.
- Footer de modale sticky pour garder les actions accessibles.
- Tables et lignes sécurisées contre le chevauchement de texte.

## Technique
- Version des assets : 7.0.0.
- Service worker/cache V7.
- Background embarqué dans le dépôt : pas de dépendance externe.
- Fonctionnement Supabase/V6.4 conservé.

## 7.1 — 2026-09-29
- Modification complète des trades clôturés depuis Journal, Historique et fiche de trade.
- Boutons Gain / Perte / Break-even avec correction du PnL et du R.
- Réconciliation automatique du solde du compte après correction d'un trade clôturé.
- Possibilité de corriger compte, actif, direction, stratégie, dates, entrée, SL, TP, risque, PnL, R et notes.
- Journal d'audit « Correction post-clôture » conservant l'avant/après.
- Option de reconstruire l'historique de sortie pour supprimer une clôture erronée.
- Fond BOSCOFX rendu plus visible dans toutes les vues, tout en gardant les cartes lisibles.
