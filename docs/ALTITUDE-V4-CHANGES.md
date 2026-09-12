# ALTITUDE OS V4 — Refonte produit

Cette version transforme ALTITUDE OS en produit multi-utilisateur générique destiné à la commercialisation.

## Changement majeur de philosophie

La stratégie propriétaire du créateur n'est plus codée dans le produit. Chaque utilisateur construit sa propre stratégie dans **Stratégies** :

- conditions d'entrée ;
- confirmations ;
- règles de risque ;
- validation et sortie.

Lors de chaque nouveau trade, ALTITUDE OS exige la confirmation complète de la checklist de la stratégie choisie avant d'ouvrir le calcul de risque.

## Fonctionnalités ajoutées

- plusieurs comptes de trading par utilisateur ;
- solde et risque propres à chaque compte ;
- risque fixe ou en pourcentage ;
- recalcul automatique du montant à risque ;
- modification du solde à tout moment ;
- stratégie personnalisée par client ;
- plusieurs stratégies actives ;
- position ouverte avec sorties partielles ;
- fermeture manuelle avant TP ;
- prix de sortie + PnL réel facultatif ;
- mise à jour automatique du solde après chaque sortie ;
- historique semaine / mois / trimestre / année ;
- export CSV de l'historique ;
- productivité / performance avec courbe, heatmap, win rate, R moyen et profit factor ;
- profil complet avec photo, nom, pays, fuseau et expérience ;
- 5 thèmes : Midnight, Summit, Obsidian, Glacier, Carbon ;
- command palette CMD/CTRL + K ;
- remise à zéro complète de l'espace ;
- export JSON ;
- toasts et dialogues internes à la place des alertes navigateur ;
- interface responsive.

## Compatibilité backend

La structure Supabase existante reste compatible : les nouvelles données sont stockées dans le JSONB `user_states`, sans migration SQL obligatoire.
