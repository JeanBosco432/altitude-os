# ALTITUDE OS

ALTITUDE OS est un **trading operating system** personnel orienté discipline, stratégies personnalisées, gestion du risque, journalisation, historique et progression.

## V5 — ce qui change

- Aucune stratégie propriétaire n’est codée dans le produit : chaque utilisateur construit sa propre checklist.
- Confirmation obligatoire de la stratégie personnelle avant la création d’une position.
- Plusieurs comptes de trading dans le même espace.
- Solde et risque modifiables à tout moment, par compte, avec recalcul automatique.
- Historique des ajustements de solde.
- Risque fixe ou en pourcentage.
- Sortie manuelle avant TP, sortie partielle, TP, SL, break-even ou invalidation.
- Modification d’une position ouverte : SL, TP et note, avec historique des changements.
- Calcul automatique du PnL d’une sortie et possibilité de saisir le PnL réellement exécuté.
- Journal filtrable, triable et paginé.
- Captures avant/après trade : Storage Supabase privé en cloud, données locales en mode démo.
- Historique navigable semaine par semaine, mois par mois, trimestre par trimestre et année par année.
- Productivité : PnL, R, win rate, profit factor, drawdown, qualité d’exécution, séries et performance par stratégie.
- Distinction entre **résultat financier** et **qualité du trade**.
- Revue individuelle des trades + revue hebdomadaire.
- Livre de règles avec statuts, favoris et suivi des violations.
- Profil utilisateur enrichi avec photo.
- 5 thèmes : Midnight, Summit, Obsidian, Glacier et Carbon.
- Export/import JSON, export CSV et remise à zéro.
- PWA activée uniquement en production HTTPS pour éviter les problèmes de cache en développement local.
- La palette de recherche est créée uniquement à la demande (`⌘K`) et n’apparaît jamais au démarrage.

Voir `docs/ALTITUDE-V5-CHANGES.md`.

## Architecture

- **Frontend** : HTML / CSS / JavaScript sans framework lourd.
- **Hébergement** : GitHub Pages.
- **Authentification / base / stockage** : Supabase.
- **Données utilisateur** : état JSONB privé dans `user_states`, isolé par RLS.
- **Cache local** : `localStorage` par utilisateur.
- **Suppression de compte** : Edge Function `delete-account`.
- **Paiement** : infrastructure préparée, désactivée tant que `BILLING_ENABLED=false`.

La V5 reste compatible avec l’architecture Supabase existante : les nouveaux champs sont ajoutés dans le JSON utilisateur et les anciens états sont migrés côté navigateur par `mergeState()`.

## Test local

```bash
cd ~/Downloads/altitude-os-production
python3 -m http.server 8080
```

Puis :

```text
http://localhost:8080/
```

Le service worker n’est pas enregistré sur `localhost`.

## Configuration

Le vrai `config.js` local ne doit jamais être commité. Il contient uniquement des paramètres publics d’exécution :

```js
window.ALTITUDE_CONFIG = {
  SUPABASE_URL: '...',
  SUPABASE_ANON_KEY: '...',
  APP_URL: 'https://altitudetrad.com/',
  BILLING_ENABLED: false
};
```

Ne place jamais la clé Supabase `service_role` dans le frontend.

## Commercialisation

Avant d’activer la vente :

- finaliser les plans Free / Premium ;
- activer Stripe et ses Edge Functions ;
- finaliser CGU, confidentialité, remboursement et mentions légales ;
- tester les parcours inscription → onboarding → stratégie → trade → sortie → revue ;
- vérifier la suppression de compte et les exports ;
- faire un test multi-utilisateur RLS.

Voir `docs/COMMERCIALISATION.md` et `docs/SECURITY.md`.
