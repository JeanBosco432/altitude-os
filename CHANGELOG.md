# ALTITUDE Trade 6.4

## Nouveau trade / Journal / Gestion
- Formulaire de trade enrichi : compte, actif filtré, stratégie, direction, contexte, date/heure, timeframes tendance et entrée, session, confirmation, confiance et état avant trade.
- Stratégie personnelle MM20 + S/R + Confirmation M5 initialisée automatiquement uniquement lorsqu’aucune stratégie n’existe.
- Risque synchronisé en pourcentage et en montant, R:R prévu et taille indicative calculés automatiquement.
- Drag & drop de plusieurs captures avant le trade, consultation et zoom dans le journal.
- Journal enrichi avec positions ouvertes, risque exposé, PnL du jour et historique.
- Gestion d’une position : SL/TP, passage à break-even, sorties 25/50/75/100 %, sorties partielles multiples, PnL réel facultatif et journal de modifications.
- Statistiques : ventilation supplémentaire par confirmation d’entrée.
- Cache-busting V6.4.

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
