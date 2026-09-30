# ALTITUDE Trade V8 — Design System « Gold Terminal »

## Identité
- Produit : ALTITUDE Trade · Signature : BOSCOFX
- Direction : terminal de trading premium — obsidienne, verre dépoli, or.

## Palette (thème Midnight)
| Rôle | Valeur |
|---|---|
| Fond | `#050608` |
| Verre (cartes) | `rgba(12,13,17,.70)` + `backdrop-filter: blur(22px)` |
| Bordure | `rgba(255,255,255,.075)` |
| Texte / secondaire / tertiaire | `#F6F2E9` / `#B8B1A2` / `#7F796D` |
| Or | `#F3BD55` · sombre `#B77725` · clair `#FFE3A3` |
| Dégradé or | `#FFF0C4 → #F6C65F → #D9982F → #9C6116` |
| Gain / Perte / BE | `#2FD3A0` / `#EF5A72` / `#F0A93B` |

Les thèmes Obsidian, Summit, Glacier et Carbon ne changent que l'accent et l'intensité du fond.

## Typographie
- Titres : Instrument Serif (italique or pour l'accent)
- Interface : Manrope 400–800
- Chiffres : IBM Plex Mono / chiffres tabulaires

## Rythme
- Espacements 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 px
- Rayons 8 / 10 / 14 / 18 / 24 / 32 px
- Champs : 52 px (44 px en densité compacte), label séparé de 8 px

## Fond BOSCOFX
`assets/boscofx-trader-bg.webp` est posé en `.app-wallpaper` (fixe, dérive lente) sous un voile
dégradé réglable par `--wall-opacity` et `--veil-*`. Il réapparaît en clair dans le bandeau héros,
la carte « motto » de la sidebar, l'en-tête du profil et les aperçus de thème.

## Composants clés
- `.hero` — bandeau du tableau de bord
- `.metric-card` + `.metric-icon` — KPI (4e argument de `metric()` = tonalité gain/perte)
- `.chart` — courbe lissée SVG + point de dernière valeur
- `.pnl-bars` — barres positives/négatives
- `.cal-grid` — calendrier de trading
- `.trade-table` — table unifiée, en cartes sous 760 px
- `.mobile-dock` — navigation mobile

## Responsive
- ≥ 1181 px : grilles complètes
- ≤ 1180 px : héros et graphiques en une colonne
- ≤ 980 px : sidebar en tiroir + barre de navigation mobile
- ≤ 760 px : tables en cartes, modales en bottom sheet
