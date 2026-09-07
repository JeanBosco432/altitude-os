# Checklist avant commercialisation

La plateforme technique est préparée pour plusieurs comptes. Pour vendre légalement et proprement l'accès, il reste des décisions commerciales que le code ne peut pas choisir à ta place.

## Obligatoire avant paiement

- nom juridique de l'éditeur / entreprise ;
- pays d'établissement ;
- email support ;
- prix ;
- périodicité : mensuel, annuel ou achat unique ;
- prestataire de paiement ;
- politique de remboursement ;
- CGU ;
- politique de confidentialité ;
- mentions légales applicables ;
- nom de domaine ;
- adresse email transactionnelle.

## Paiement recommandé

Architecture prévue :

```text
Utilisateur
   -> Stripe Checkout
   -> webhook serveur
   -> Supabase subscriptions
   -> profiles.plan = pro
```

Ne mets jamais les clés secrètes Stripe dans GitHub Pages.

Le webhook doit être exécuté côté serveur, par exemple via Supabase Edge Functions.

## Plans

La base contient déjà :

```text
free
pro
lifetime
admin
```

Le prix n'est volontairement pas codé car il n'a pas encore été décidé.

## Fonctionnalités possibles à réserver au plan Pro

Exemples à décider plus tard :

- historique illimité ;
- captures cloud ;
- statistiques avancées ;
- export ;
- plusieurs stratégies ;
- personnalisation des règles de risque.

## Positionnement juridique produit

ALTITUDE OS doit rester présenté comme :

- outil de journalisation ;
- outil de discipline ;
- outil d'organisation et d'analyse personnelle.

Évite de le présenter comme un service garantissant des profits ou comme un conseil financier personnalisé si tu n'as pas le cadre réglementaire correspondant.

## Activer Stripe quand tu auras choisi ton prix

Les Edge Functions sont déjà incluses :

```text
create-checkout-session
billing-portal
stripe-webhook
```

À ce moment-là :

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_...
supabase secrets set STRIPE_PRICE_ID=price_...
supabase secrets set STRIPE_WEBHOOK_SIGNING_SECRET=whsec_...
supabase secrets set APP_URL=https://ton-domaine.com/

supabase functions deploy create-checkout-session
supabase functions deploy billing-portal
supabase functions deploy stripe-webhook --no-verify-jwt
```

Dans Stripe, crée un webhook vers l'URL de la fonction `stripe-webhook` et écoute au minimum :

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Puis mets la variable GitHub `BILLING_ENABLED` à `true`.

Le bouton **Passer Pro** apparaîtra dans les paramètres des comptes cloud.
