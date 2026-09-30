# Synchronisation MetaTrader 5 → ALTITUDE Trade (V8.1)

Vos positions clôturées sur MT5 arrivent **toutes seules** dans votre journal ALTITUDE, en quelques secondes.

```
MT5 (EA AltitudeSync, lecture seule) ──► Supabase Edge Function « mt5-ingest » ──► table broker_inbox
                                                                                     │
ALTITUDE (toutes les 45 s + à l'ouverture) ◄──────────────────────────────────────────┘
   → relie au trade saisi à la main (±20 min) OU crée le trade
   → met à jour le solde du compte → trade « à compléter » (stratégie, confirmation…)
```

**Sécurité**
- L'EA **ne passe, ne modifie et ne ferme aucun ordre**. Il lit l'historique et l'envoie.
- Aucun mot de passe de trading n'est demandé.
- Le jeton ne sert qu'à *envoyer* des trades vers votre journal. Seul son hash est stocké. Vous pouvez le révoquer à tout moment.

---

## Étape 1 — Supabase (une seule fois, ~5 min)

### 1a. Créer les tables
Supabase → **SQL Editor** → New query → collez tout le contenu de `supabase/mt5-sync.sql` → **Run**.
Le script ne touche à aucune donnée existante et peut être relancé sans risque.

### 1b. Déployer la fonction `mt5-ingest`

**Option terminal (recommandée)**
```bash
cd ~/Downloads/altitude-os-production
npx supabase login
npx supabase functions deploy mt5-ingest --no-verify-jwt --project-ref VOTRE_PROJECT_REF
```
`VOTRE_PROJECT_REF` est la partie avant `.supabase.co` dans votre URL Supabase.

**Option tableau de bord**
Supabase → **Edge Functions** → *Deploy a new function* → *Via Editor* → nom : `mt5-ingest` → collez le contenu de `supabase/functions/mt5-ingest/index.ts` → Deploy.
Puis dans les réglages de la fonction : **désactivez « Enforce JWT verification »** (l'EA s'authentifie avec son jeton, pas avec un JWT).

---

## Étape 2 — Mettre en ligne la V8.1
Commandes Terminal fournies avec le ZIP (même procédure que d'habitude, `config.js` préservé).

---

## Étape 3 — Dans ALTITUDE (connecté avec votre email)
**Paramètres → Connexion MetaTrader 5 → Générer un jeton**.
Copiez le **jeton** et l'**URL de synchronisation** (ils ne seront plus affichés ensuite ; vous pourrez en générer un nouveau).

---

## Étape 4 — Dans MetaTrader 5 (Mac ou PC)

1. Téléchargez `AltitudeSync.mq5` (bouton dans Paramètres, ou `https://altitudetrad.com/mt5/AltitudeSync.mq5`).
2. MT5 → **Fichier → Ouvrir le dossier des données** → `MQL5` → `Experts` → déposez le fichier.
3. Dans le **Navigateur** (Ctrl+N), clic droit sur *Expert Advisors* → **Actualiser**. Double-cliquez sur `AltitudeSync` pour l'ouvrir dans MetaEditor, puis **Compiler (F7)** : « 0 errors » attendu.
4. MT5 → **Outils → Options → Expert Advisors** → cochez **« Autoriser WebRequest pour les URL listées »** → ajoutez `https://VOTRE_PROJECT_REF.supabase.co` → OK.
5. Glissez **AltitudeSync** sur n'importe quel graphique (ex. XAUUSD M5) → onglet **Paramètres** :
   | Paramètre | Valeur |
   |---|---|
   | InpEndpoint | l'URL copiée depuis ALTITUDE |
   | InpToken | le jeton copié depuis ALTITUDE |
   | InpBackfillDays | **7** (rattrape les trades des 7 derniers jours ; aucun doublon possible) |
   | InpTimerSeconds | 15 |
6. En haut à gauche du graphique : `Statut : Connecté OK`.
   L'EA ne trade pas : le bouton *Algo Trading* n'est normalement pas nécessaire. Si le statut reste bloqué sur « Démarrage… », activez-le.

**Plusieurs comptes (JustMarkets + FundedNext + Deriv MT5)** : MT5 est connecté à un compte à la fois. L'EA synchronise le compte actif ; quand vous changez de compte, il reprend automatiquement là où il s'était arrêté pour ce compte. Les trades passés depuis le téléphone sont envoyés à la prochaine ouverture de MT5 sur l'ordinateur.

**FundedNext / prop firms** : l'EA ne fait qu'envoyer des données, mais vérifiez dans les règles de votre challenge que l'utilisation d'un EA non-trading est autorisée.

---

## Étape 5 — Associer les comptes
Dans **Paramètres → Connexion MT5 → Comptes MT5 détectés**, chaque compte apparaît avec son solde réel.
JustMarkets, FundedNext et Deriv sont associés automatiquement quand le nom du broker est reconnu ; sinon choisissez le compte ALTITUDE dans la liste.

- Les trades clôturés **avant** la première connexion de l'EA sont mis de côté : bouton **« Importer l'historique (N) »**.
- Un trade déjà saisi à la main (même compte, même actif, même sens, ouverture à ±20 min) est **relié**, jamais dupliqué.
  - S'il était **ouvert** dans ALTITUDE : il est clôturé automatiquement avec les chiffres exacts de MT5 (vos notes, captures et checklist sont conservées).
  - S'il était **déjà clôturé** avec un PnL différent : badge **« écart MT5 »** + bouton **« Aligner sur MT5 »** dans le détail du trade.

---

## Trades « à compléter »
MT5 ne connaît ni votre stratégie, ni la confirmation (engulfing, hammer…), ni le contexte.
Journal → bannière **« N trades importés à compléter »** → formulaire rapide (10 s par trade).
Le **risque réel** (et donc le R) est calculé par l'EA à partir du SL initial ; vous pouvez le corriger.

---

## Import manuel (secours)
MT5 → onglet **Historique** → clic droit → **Rapport** → **HTML**.
ALTITUDE → Paramètres → Connexion MT5 → **Importer un rapport**. Choisissez le compte et le fuseau du serveur.
Fonctionne aussi en mode démo. Les doublons sont ignorés.

---

## Dépannage
| Message sur le graphique MT5 | Solution |
|---|---|
| `URL non autorisée` | Étape 4.4 : ajoutez l'URL Supabase dans Outils → Options → Expert Advisors |
| `Refusé par le serveur (401)` | Jeton faux ou révoqué → générez-en un nouveau. Si le message parle d'« authorization » : désactivez « Enforce JWT verification » sur la fonction (étape 1b) |
| `Refusé par le serveur (404)` | La fonction `mt5-ingest` n'est pas déployée (étape 1b) |
| `Refusé par le serveur (500)` | Les tables n'existent pas : relancez `supabase/mt5-sync.sql` (étape 1a) |
| Rien dans ALTITUDE mais statut OK | Paramètres → Connexion MT5 : le compte doit être **associé** à un compte ALTITUDE |
