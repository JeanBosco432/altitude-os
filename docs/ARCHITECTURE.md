# Architecture ALTITUDE OS

## Frontend

Application statique légère :

- `index.html` : shell visuel ;
- `src/styles.css` : design system validé ;
- `src/main.js` : moteur UI, stratégie, journal, risque, auth et synchronisation ;
- `config.js` : paramètres publics runtime.

Aucun serveur frontend n'est requis.

## Backend

Supabase fournit :

- Auth ;
- PostgreSQL ;
- Row Level Security ;
- Storage privé ;
- Edge Functions.

## Mémoire utilisateur

Chaque compte possède une ligne `user_states` :

```text
user_id -> state JSONB
```

Le state contient notamment :

- paramètres de risque ;
- capital ;
- trades ;
- règles ;
- revues hebdomadaires ;
- brouillons ;
- analyse active ;
- locks.

Une copie est aussi conservée dans `localStorage` comme cache local.

### Pourquoi JSONB pour la V1 commerciale ?

La quantité de données d'un journal personnel reste raisonnable et cette architecture :

- réduit fortement les risques de bugs de synchronisation ;
- permet de faire évoluer la stratégie rapidement ;
- facilite l'import/export ;
- conserve une isolation parfaite par utilisateur via RLS.

Si le produit devient très volumineux, les trades et revues pourront être migrés vers des tables relationnelles dédiées sans refaire l'interface.

## Images

Les captures sont compressées dans le navigateur puis envoyées dans le bucket privé :

```text
trade-media/<user-id>/<trade-id>/before.jpg
trade-media/<user-id>/<trade-id>/after.jpg
```

Les politiques Storage empêchent un utilisateur d'accéder au dossier d'un autre utilisateur.

## Auth

Flux disponibles :

- inscription email + mot de passe ;
- confirmation email ;
- connexion ;
- réinitialisation mot de passe ;
- déconnexion ;
- suppression complète de compte.

## Modèle de stratégie

ALTITUDE OS ne contient aucune stratégie de trading propriétaire. Chaque utilisateur crée ses propres stratégies dans son état privé.

Une stratégie contient notamment :

- conditions d’entrée ;
- confirmations ;
- règles de risque ;
- règles de sortie ;
- marchés et unités de temps libres.

Avant la création d’une position, la checklist de la stratégie sélectionnée est confirmée. Une copie (`strategySnapshot`) est enregistrée dans le trade pour préserver l’historique même si la stratégie change ensuite.

## Limites de la version actuelle

- elle ne lit pas automatiquement TradingView ou un broker ;
- elle ne passe aucun ordre ;
- les signaux sont confirmés manuellement par l'utilisateur ;
- le paiement n'est pas activé sans prix ni compte Stripe fournis par le propriétaire.
