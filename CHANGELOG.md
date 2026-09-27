# ALTITUDE Trade 6.3

- Correction critique du moteur statistique : `maxDrawdownPct` utilisait un identifiant inexistant au lieu de `maxDDPct`.
- Correction appliquée aux deux moteurs statistiques afin de restaurer Tableau de bord, Comptes, Historique et Statistiques.
- Cache-busting V6.3 pour empêcher le navigateur de recharger l’ancien JavaScript.
- Validation automatique des vues principales en navigateur headless avant livraison.

# Changelog

## 6.2.0
- Réécriture défensive des vues Dashboard, Comptes, Historique et Statistiques.
- Trois comptes principaux garantis : Deriv, JustMarkets, FundedNext.
- Visualisations disponibles sans données.
- Protection contre les anciennes données mal formées.
- Diagnostic d’erreur visible dans l’application.
- Nouveau cache service worker V6.2.
