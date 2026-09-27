# ALTITUDE Trade V6.4

Version centrée sur la saisie, le suivi et l'analyse complète des trades.

## Inclus dans V6.4
- Trois environnements séparés : Deriv, JustMarkets et FundedNext.
- Actifs filtrés automatiquement selon le compte sélectionné.
- Nouveau trade enrichi : stratégie, direction, contexte, date/heure, timeframes tendance/entrée, session, confirmation, confiance, état avant trade et observation personnelle.
- Stratégie personnelle `MM20 + S/R + Confirmation M5` créée automatiquement uniquement lorsqu'aucune stratégie n'existe encore.
- Calcul automatique du risque en % et en montant, R:R prévu et taille indicative.
- Captures avant / pendant / après avec drag & drop, galerie, plein écran et zoom.
- Journal avec trades ouverts, risque exposé, PnL du jour et historique complet.
- Gestion d'une position : modification SL/TP, passage à break-even, sorties partielles 25/50/75/100 %, PnL réel facultatif et journal des modifications.
- Statistiques globales, par compte, actif, stratégie, direction et confirmation.
- Dashboard, comptes, historique et statistiques robustes avec migration des anciennes données.

## Installation
Conserver votre `config.js` existant lors de la copie afin de garder la configuration Supabase actuelle.

```bash
rsync -av --exclude='.git' --exclude='config.js' ALTITUDE-TRADE-V6.4/ votre-projet/
```

Puis lancer `bash scripts/verify.sh`.
