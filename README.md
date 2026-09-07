# ALTITUDE OS

Plateforme personnelle de trading orientée **discipline, stratégie, gestion du risque, journalisation et revue hebdomadaire**.

## Ce qui est inclus

- Design premium ALTITUDE OS basé sur la direction artistique validée.
- Splash screen ALTITUDE OS avec **3 points qui s'activent l'un après l'autre**.
- Comptes utilisateurs via Supabase Auth : inscription, connexion, vérification email, mot de passe oublié.
- Mémoire par compte : synchronisation cloud + cache local.
- Isolation des données par utilisateur via Supabase Row Level Security (RLS).
- Captures avant/après trade dans un bucket Supabase privé.
- Mode démo local utilisable sans backend.
- Analyse H1 → M30 → M5 avec scénarios HHH / BBB / HHB / BBH.
- Setups actuellement définis : marteaux, marteaux inversés, avalements, flèches directionnelles, réintégrations et séquences de marteaux déjà décrites.
- Risk Manager : risque fixe, ratio minimum, objectif 1:3, limites jour/semaine/mois.
- Journal, qualité d'exécution, PnL et R.
- Revue hebdomadaire obligatoire samedi → vendredi et verrouillage si elle n'est pas terminée.
- Livre de règles.
- Statistiques.
- Export / import JSON.
- Suppression de compte via Supabase Edge Function fournie.
- Déploiement GitHub Pages automatisé par GitHub Actions.

## Architecture

- **Frontend** : HTML / CSS / JavaScript modules, sans framework lourd.
- **Hébergement frontend** : GitHub Pages.
- **Authentification / base / stockage** : Supabase.
- **Données utilisateur** : une ligne JSONB privée dans `user_states`, isolée par RLS.
- **Captures** : bucket privé `trade-media`.
- **Suppression de compte** : Edge Function `delete-account`.

Ce choix garde l'application légère et fidèle au design actuel. Une migration vers React n'est pas nécessaire pour lancer le produit ; elle pourra être faite plus tard si l'équipe ou le produit grossit fortement.

## Test local ultra rapide

Dans Terminal :

```bash
cd chemin/vers/altitude-os-production
python3 -m http.server 8080
```

Puis ouvre :

```text
http://localhost:8080
```

Ou sur Mac, tu peux double-cliquer sur `serve.command` si macOS l'autorise. Le terminal doit rester ouvert pendant le test.

Sans Supabase configuré, clique sur **Continuer en mode démo locale**.

## Activer les comptes cloud

Voir `docs/DEPLOYMENT.md`. Les étapes principales sont :

1. créer un projet Supabase ;
2. exécuter `supabase/schema.sql` ;
3. récupérer l'URL du projet et la clé publishable/anon ;
4. configurer les URLs d'authentification ;
5. déployer l'Edge Function de suppression de compte ;
6. ajouter les variables/secrets dans GitHub ;
7. activer GitHub Pages avec GitHub Actions.


## Règles de stratégie encore volontairement bloquées

Certaines variantes que tu as décrites n'avaient pas encore un niveau d'entrée ou de stop-loss totalement univoque. Elles sont **visibles dans ALTITUDE OS mais marquées « À COMPLÉTER » et ne peuvent pas créer de trade**. Le code ne devine donc aucune règle de trading.

Quand tu compléteras ces setups, il suffira de modifier leur définition dans `src/main.js` et de retirer `draft:true` après validation de la règle.

## Important avant de commercialiser

Le code fournit l'infrastructure technique de comptes et de données privées. Avant de vendre l'accès, il faut encore renseigner les éléments que le code ne peut pas inventer pour toi :

- identité légale de l'éditeur ;
- adresse / email de support ;
- CGU ;
- politique de confidentialité ;
- politique de remboursement ;
- prix des abonnements ;
- compte Stripe ou autre prestataire de paiement ;
- domaine définitif.

Voir `docs/COMMERCIALISATION.md`.

## Sécurité

Ne mets **jamais** la clé Supabase `service_role` dans `config.js`, GitHub Pages ou le JavaScript frontend. Seule la clé publishable/anon doit être utilisée par le navigateur, avec RLS activé.

Voir `docs/SECURITY.md`.
