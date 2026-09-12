# ALTITUDE OS V5 — mise à jour fonctionnelle

## 1. Positionnement produit
ALTITUDE OS n’embarque plus la stratégie du créateur. Le produit devient un système générique et commercialisable : chaque utilisateur configure sa propre stratégie et sa propre checklist.

## 2. Stratégies personnelles
Une stratégie contient :
- conditions d’entrée ;
- confirmations ;
- règles de risque ;
- règles de sortie ;
- marchés concernés ;
- unités de temps.

Avant chaque nouveau trade, l’utilisateur doit confirmer toutes les règles de sa stratégie. Une copie de la stratégie est enregistrée dans le trade afin que l’historique reste cohérent même si la stratégie est modifiée plus tard.

## 3. Comptes de trading
Chaque utilisateur peut créer plusieurs comptes avec :
- nom ;
- courtier / prop firm ;
- type ;
- devise ;
- solde ;
- risque fixe ou en pourcentage ;
- compte principal.

Une modification manuelle de solde est journalisée comme ajustement et n’efface pas l’historique des trades.

## 4. Gestion des positions
Une position ouverte peut :
- être clôturée avant le TP ;
- être clôturée partiellement ;
- être clôturée au TP, SL ou break-even ;
- recevoir une raison et une note de sortie ;
- utiliser un PnL calculé automatiquement ou un PnL réel saisi manuellement ;
- modifier SL / TP avec historique des changements.

Chaque sortie met automatiquement à jour le solde du compte concerné.

## 5. Journal et historique
Le journal est destiné aux trades récents et propose recherche, compte, stratégie, statut, résultat et tri.

L’historique permet de naviguer dans de vraies archives :
- semaine précédente / suivante ;
- mois précédent / suivant ;
- trimestre précédent / suivant ;
- année précédente / suivante.

Chaque période possède ses filtres, indicateurs, pagination et export CSV.

Les trades peuvent aussi recevoir une capture avant et une capture après. En cloud, elles sont stockées dans le bucket privé `trade-media`.

## 6. Productivité
Les vues disponibles sont :
- 20 derniers trades ;
- mois ;
- trimestre ;
- année ;
- tout l’historique.

Mesures :
- PnL ;
- total R ;
- win rate ;
- R moyen / espérance ;
- profit factor ;
- drawdown max ;
- qualité d’exécution ;
- séries gagnantes / perdantes ;
- performance par stratégie.

## 7. Résultat vs qualité
Un trade peut être gagnant et mal exécuté, ou perdant et correctement exécuté. La V5 conserve donc deux axes séparés :
- résultat financier ;
- qualité du processus.

## 8. Revue et règles
Chaque trade clôturé peut être évalué individuellement. La revue hebdomadaire affiche la progression des trades revus et permet de générer une règle.

Le Livre de règles prend en charge :
- Active ;
- À surveiller ;
- Archivée ;
- favori ;
- compteur de violations.

## 9. Profil et apparence
Profil enrichi : prénom, nom, nom affiché, ville, pays, fuseau horaire, langue, expérience, style de trading, bio et photo.

Thèmes : Midnight, Summit, Obsidian, Glacier et Carbon.

## 10. Données
- export JSON complet ;
- import JSON ;
- export CSV ;
- remise à zéro du journal ;
- remise à zéro complète ;
- synchronisation Supabase + cache local.

## 11. PWA
Le manifest et le service worker sont fournis. Le service worker n’est enregistré qu’en HTTPS afin de ne pas perturber le développement local.
