# QA — checklist avant mise en ligne

## Splash

- [ ] Le logo ALTITUDE OS apparaît immédiatement.
- [ ] Les 3 points s'activent successivement.
- [ ] L'écran disparaît après environ 1,25 s.
- [ ] Si Supabase est indisponible, l'écran de connexion apparaît quand même et le mode démo reste accessible.

## Auth

- [ ] Créer Compte A.
- [ ] Confirmer son email.
- [ ] Se connecter.
- [ ] Se déconnecter.
- [ ] Mot de passe oublié.
- [ ] Créer Compte B.
- [ ] Vérifier que B ne voit aucune donnée de A.

## Analyse

- [ ] H1/M30 non alignés => aucun scénario.
- [ ] HHH détecté correctement.
- [ ] BBB détecté correctement.
- [ ] HHB détecté correctement.
- [ ] BBH détecté correctement.
- [ ] Les setups marqués « à compléter » ne peuvent pas être envoyés au Risk Manager.

## Risk Manager

- [ ] BUY : SL sous entrée et TP au-dessus.
- [ ] SELL : SL au-dessus entrée et TP en dessous.
- [ ] Ratio < 1:2 => trade impossible.
- [ ] Ratio >= 1:2 => trade possible.
- [ ] +3R clôturé => blocage de la journée.
- [ ] 2 trades => blocage de la journée.
- [ ] 5 pertes semaine => blocage semaine.
- [ ] 10 gains semaine => blocage semaine.
- [ ] Capital >= objectif mensuel => blocage mois.

## Journal

- [ ] Création du trade.
- [ ] Capture avant.
- [ ] Clôture WIN / LOSS / BE.
- [ ] Calcul R correct.
- [ ] Calcul PnL correct.
- [ ] Capital mis à jour.
- [ ] Qualité d'exécution distincte du résultat financier.
- [ ] Capture après.

## Revue

- [ ] Période analysée = samedi → vendredi.
- [ ] Revue disponible samedi/dimanche.
- [ ] Lundi, revue précédente non terminée => verrouillage.
- [ ] Tous les champs de chaque trade sont obligatoires.
- [ ] Règle ajoutée au Livre de règles.
- [ ] Déverrouillage après validation.

## Cloud

- [ ] Données sauvegardées, puis visibles après reconnexion sur un autre navigateur.
- [ ] Captures visibles après reconnexion.
- [ ] RLS testé entre deux utilisateurs.
- [ ] Export JSON fonctionne.
- [ ] Suppression du compte supprime les données et l'utilisateur.
