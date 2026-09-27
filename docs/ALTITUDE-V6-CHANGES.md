# ALTITUDE Trade V6 — Journal & Analytics

## 1. Comptes

Chaque compte conserve son propre capital initial, solde, risque, broker, type de marché, liste d'actifs et historique. Les vues statistiques peuvent être filtrées compte par compte.

## 2. Nouveau trade

Le flux enregistre désormais : compte, stratégie, actif, direction, timeframe, session, confirmation, niveaux, risque, note et médias avant trade.

## 3. Trades en cours

Le Journal affiche un bloc dédié aux positions ouvertes. Les sorties partielles ou totales mettent à jour le solde du compte concerné.

## 4. Médias

Les médias sont devenus une vraie galerie : plusieurs images avant/après, drag & drop, compression, Storage Supabase privé, visualisation plein écran et zoom.

## 5. Statistiques

Les périodes disponibles sont jour, semaine, mois, trimestre, année et historique complet. Les mesures couvrent : PnL, R, win rate, loss rate, BE, profit factor, expectancy, payoff, drawdown en montant et pourcentage, risque moyen, séries de gains/pertes, extrêmes temporels et ventilations par actif, stratégie, compte et direction.

## 6. Compatibilité

Le schéma Supabase ne change pas : la V6 ajoute les nouveaux champs dans le JSON privé de l'utilisateur. Les médias V5 unitaires sont migrés vers des tableaux de médias.


## V6.4 — Trade Capture & Management
Nouveau flux de saisie, journal enrichi, gestion BE/partiels, média et statistiques par confirmation.
