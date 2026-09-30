#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v node >/dev/null 2>&1; then
  node --check src/main.js
else
  echo "ALTITUDE Trade: Node.js absent — contrôle syntaxique JS ignoré."
fi

python3 - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
class Parser(HTMLParser): pass
p=Parser(); p.feed(Path('index.html').read_text())
required=['index.html','config.example.js','favicon.svg','manifest.webmanifest','sw.js','CNAME','assets/boscofx-trader-bg.webp','src/main.js','src/styles.css','supabase/schema.sql','supabase/mt5-sync.sql','supabase/functions/mt5-ingest/index.ts','mt5/AltitudeSync.mq5','.github/workflows/deploy-pages.yml']
missing=[x for x in required if not Path(x).exists()]
if missing: raise SystemExit('Missing: '+', '.join(missing))

html=Path('index.html').read_text()
css=Path('src/styles.css').read_text()
workflow=Path('.github/workflows/deploy-pages.yml').read_text()
for token in ['styles.css?v=8.1.0','main.js?v=8.1.0','sw.js?v=8.1.0','boscofx-trader-bg.webp']:
    if token not in html and token not in css:
        raise SystemExit(f'Missing V8 asset/version token: {token}')
for token in ['manifest.webmanifest','sw.js','assets/.','_site/config.js','SUPABASE_URL','SUPABASE_ANON_KEY','mt5/AltitudeSync.mq5']:
    if token not in workflow:
        raise SystemExit(f'GitHub Pages workflow misses asset: {token}')

js=Path('src/main.js').read_text().lower()
for forbidden in ['hhh','bbb','hhb','bbh']:
    if forbidden in js:
        raise SystemExit(f'Hardcoded strategy term found in runtime: {forbidden}')

source=Path('src/main.js').read_text()
if 'maxDrawdown:maxDD,maxDrawdownPct,' in source:
    raise SystemExit('Runtime bug detected: maxDrawdownPct must map to maxDDPct explicitly')
for required_token in ['maxDrawdownPct:maxDDPct','function v62Stats','function statsFor','function openNewTrade','function openCloseTradeModal','function openClosedTradeEditModal','strat_mm20_sr_m5','byConfirmation=v62Breakdown','function v8TradeTable','const accounts=state.accounts.slice(),strategies=','function importBrokerPositions','function brokerSync']:
    if required_token not in source:
        raise SystemExit(f'Missing runtime invariant: {required_token}')
print('ALTITUDE Trade: files/runtime checks OK')
PY
