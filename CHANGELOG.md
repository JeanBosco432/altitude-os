# ALTITUDE Trade V8.0 — « Gold Terminal » (2026-09-30)

## Refonte visuelle complète
- Nouveau design system BOSCOFX : obsidienne, verre dépoli, dégradés or, typographie éditoriale (Instrument Serif) + chiffres tabulaires.
- Fond BOSCOFX fixe et animé derrière **toutes** les pages, avec voile de lisibilité ; visible aussi dans la sidebar, le profil, les stratégies et les aperçus de thème.
- Nouvelle vitrine / page de connexion plein écran : accroche, 4 atouts, badges, carte de connexion en verre.
- Nouveau tableau de bord : bandeau héros BOSCOFX (capital total, PnL, R, trades), anneau win rate, prochaine action, positions ouvertes en direct.
- Graphiques redessinés : courbe equity/drawdown lissée avec point de dernière valeur, barres gains/pertes positives/négatives, calendrier de trading mensuel (PnL par jour), PnL mensuel.
- Statistiques enrichies : par jour de semaine, par session, barres de contribution, PnL mensuel et calendrier filtrés.
- Table des trades unifiée (Dashboard, Journal, Historique) : badge actif, statut coloré, badge « corrigé », boutons Voir / Modifier toujours visibles.
- Icônes SVG, sidebar sectionnée (Pilotage / Trading / Progression), barre de titre mobile.
- Mobile : barre de navigation flottante (Accueil, Journal, +, Stats, Menu), tableaux convertis en cartes, modales en « bottom sheet ».
- 5 thèmes revus (Midnight or, Obsidian, Summit bronze, Glacier, Carbon platine), tous sur fond BOSCOFX.

## Corrections
- **Correction post-clôture** : la liste « Compte » ne proposait que le compte principal. Enregistrer une correction déplaçait donc le trade (ex. US30 FundedNext → Deriv) et faussait les soldes. Tous les comptes sont maintenant proposés et le compte d'origine est présélectionné.
- La stratégie archivée d'un trade reste sélectionnée lors d'une correction.
- Nouveau trade : la session « Synthétique » n'est plus conservée quand on passe d'un compte Deriv à un compte Forex/Prop.
- Le détail d'un trade affiche l'historique des corrections (avant / après).
- Le menu mobile se ferme après navigation jusqu'à 980 px (au lieu de 620 px).

## Technique
- Assets versionnés 8.0.0, cache service worker `altitude-trade-v8-0-shell`.
- Aucune modification du modèle de données, de Supabase, ni de `config.js`.

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
