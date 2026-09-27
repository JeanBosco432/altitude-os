# ALTITUDE Trade V6.1

ALTITUDE Trade est un journal de trading multi-comptes orienté **exécution, médias, statistiques et progression**.

## V6 — principaux ajouts

- Vue globale de tous les comptes avec périodes : jour, semaine, mois, trimestre, année et tout l'historique.
- Comptes séparés avec capital initial, solde actuel, risque, broker/prop firm, type de marché et liste d'actifs.
- Préconfiguration pour un nouvel espace :
  - Deriv · Synthétiques : V10, V25, V75, Boom 500, Jump 10 ;
  - JustMarkets · Forex/CFD : BTCUSD, GBPJPY, XAUUSD, US30 ;
  - FundedNext · Prop Firm : BTCUSD, GBPJPY, XAUUSD, US30.
- Nouveau trade : compte, stratégie, actif, BUY/SELL, timeframe, session, confirmation, entrée, SL, TP optionnel, risque, observation.
- Gestion des positions ouvertes, sorties partielles, break-even, TP, SL et clôture manuelle.
- Mise à jour automatique du solde après chaque sortie.
- Médias améliorés : plusieurs captures avant/après, drag & drop, galerie, plein écran et zoom.
- Statistiques approfondies : PnL, R, win rate, loss rate, BE, profit factor, expectancy, payoff, drawdown, risque moyen, séries, meilleur/pire trade, meilleur jour/semaine/mois, performances par actif, compte, stratégie et direction.
- Analyse détaillée par compte avec courbe et performance par actif.
- Journal avec bloc dédié aux trades en cours.
- Export CSV enrichi avec timeframe, session, confirmation, risque et note.
- Compatibilité conservée avec l'état JSONB Supabase de la V5.

## Architecture

- Frontend : HTML / CSS / JavaScript sans framework lourd.
- Hébergement : GitHub Pages.
- Auth, base et Storage privé : Supabase.
- Données : `user_states.state` en JSONB + cache `localStorage`.
- Captures cloud : bucket privé `trade-media`.

## Configuration

Le fichier `config.js` est ignoré par Git et doit rester local / généré au déploiement.

```js
window.ALTITUDE_CONFIG = {
  SUPABASE_URL: '...',
  SUPABASE_ANON_KEY: '...',
  APP_URL: 'https://altitudetrad.com/',
  BILLING_ENABLED: false
};
```

Ne placez jamais de clé `service_role` dans le frontend.

## Test local

```bash
python3 -m http.server 8080
```

Puis ouvrir :

```text
http://localhost:8080/
```

## Vérification

```bash
bash scripts/verify.sh
```

## Mise à jour d'un projet existant

Conservez votre dossier `.git` et votre `config.js` actuel. Remplacez les fichiers applicatifs par ceux de cette archive. Les anciennes données V5 sont migrées côté navigateur par `mergeState()`.
