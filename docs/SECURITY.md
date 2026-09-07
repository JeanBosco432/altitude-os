# Sécurité ALTITUDE OS

## Règles absolues

1. Ne jamais mettre `SUPABASE_SERVICE_ROLE_KEY` dans le frontend.
2. Ne jamais désactiver RLS sur les tables utilisateur.
3. Ne jamais rendre le bucket `trade-media` public.
4. Utiliser HTTPS en production.
5. Garder la confirmation email activée.
6. Tester les politiques RLS avec deux comptes distincts avant commercialisation.

## Clé anon / publishable

Cette clé est conçue pour être utilisée par le navigateur. Elle n'accorde pas à elle seule l'accès aux données privées : la sécurité dépend des politiques RLS.

## Données utilisateur

- état applicatif : privé par `auth.uid()` ;
- captures : privées par dossier `user_id` ;
- plan d'abonnement : lecture seule côté utilisateur ;
- suppression de compte : Edge Function authentifiée, puis Admin API côté serveur.

## Checklist de test sécurité

Créer Compte A et Compte B :

- A ne doit jamais voir les trades de B ;
- A ne doit jamais pouvoir lire l'état de B via l'API ;
- A ne doit jamais accéder aux captures de B ;
- changer un `user_id` dans une requête doit être refusé par RLS ;
- la suppression de A ne doit pas supprimer B.
