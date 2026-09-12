# QA — ALTITUDE OS V5

## Démarrage / Auth
- [ ] La palette de recherche est absente au démarrage.
- [ ] Session active → Dashboard.
- [ ] Session inactive → Connexion.
- [ ] Inscription, confirmation email, connexion et mot de passe oublié fonctionnent.
- [ ] La démo locale n’est proposée qu’en local ou sans Supabase.

## Onboarding
- [ ] L’onboarding s’affiche une seule fois pour un nouvel espace.
- [ ] Prénom, compte, solde, risque et thème sont sauvegardés.

## Comptes
- [ ] Ajouter plusieurs comptes.
- [ ] Changer le compte principal.
- [ ] Modifier solde, devise, courtier et risque.
- [ ] Risque en montant fixe et en pourcentage.
- [ ] Une modification manuelle de solde crée un ajustement.
- [ ] Une position ouverte empêche la suppression du compte concerné.

## Stratégies
- [ ] Aucune stratégie n’est préchargée.
- [ ] Créer/modifier/archiver une stratégie.
- [ ] Ajouter des règles dans les 4 catégories.
- [ ] Une stratégie sans règle ne peut pas être utilisée.
- [ ] La checklist complète est obligatoire avant le calcul de risque.
- [ ] Le snapshot de stratégie reste lisible après modification/archivage.

## Trades / Risque
- [ ] Choisir compte, stratégie, actif et direction.
- [ ] Entry/SL/TP calculent correctement R:R et taille indicative.
- [ ] Un risque ponctuel peut être différent du risque par défaut du compte.
- [ ] Le trade conserve son risque historique.
- [ ] Modifier SL/TP d’une position ouverte crée une entrée d’historique.

## Sorties
- [ ] Sortie manuelle avant TP.
- [ ] Sortie partielle avec pourcentage libre.
- [ ] TP, SL, break-even, invalidation et autre raison.
- [ ] PnL automatique cohérent avec la taille initiale.
- [ ] Override PnL réel fonctionne.
- [ ] Le solde du bon compte est mis à jour.
- [ ] Une clôture complète passe le trade à `closed`.

## Captures
- [ ] Capture avant/après en mode local.
- [ ] Capture avant/après dans le bucket privé `trade-media` en cloud.
- [ ] Les images privées sont chargées via signed URL.

## Journal / Historique
- [ ] Recherche, filtres et tri du journal.
- [ ] Pagination du journal.
- [ ] Navigation semaine précédente/suivante.
- [ ] Navigation mois précédent/suivant.
- [ ] Navigation trimestre précédent/suivant.
- [ ] Navigation année précédente/suivante.
- [ ] Filtres + pagination de l’historique.
- [ ] Export CSV.

## Productivité
- [ ] 20 derniers / mois / trimestre / année / tout.
- [ ] Filtre par compte.
- [ ] PnL, R, win rate, profit factor, drawdown, qualité.
- [ ] Courbes de progression et drawdown.
- [ ] Performance par stratégie.

## Revue / Livre de règles
- [ ] Évaluer la qualité d’un trade indépendamment du résultat.
- [ ] Revue hebdomadaire avec progression.
- [ ] Création d’une règle depuis la revue.
- [ ] Statuts Active / À surveiller / Archivée.
- [ ] Favoris et compteur de violations.

## Profil / Apparence
- [ ] Photo, nom, ville, pays, langue, fuseau, expérience, style, bio.
- [ ] 5 thèmes.
- [ ] Densité et taille du texte.

## Données / Sécurité
- [ ] Export JSON.
- [ ] Import JSON.
- [ ] Reset journal.
- [ ] Reset complet en conservant le compte de connexion.
- [ ] Synchronisation Supabase.
- [ ] Deux utilisateurs ne voient jamais les données l’un de l’autre.
- [ ] Suppression de compte via Edge Function.

## Production
- [ ] `config.js` ignoré par Git.
- [ ] `BILLING_ENABLED=false` tant que Stripe n’est pas activé.
- [ ] Service worker uniquement en HTTPS, pas sur localhost.
- [ ] GitHub Pages + domaine + HTTPS fonctionnent.
