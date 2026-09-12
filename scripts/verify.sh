#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v node >/dev/null 2>&1; then
  node --check src/main.js
else
  echo "ALTITUDE OS: Node.js absent — contrôle syntaxique JS ignoré."
fi

python3 - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
class Parser(HTMLParser): pass
p=Parser(); p.feed(Path('index.html').read_text())
required=['index.html','config.js','favicon.svg','manifest.webmanifest','sw.js','src/main.js','src/styles.css','supabase/schema.sql','.github/workflows/deploy-pages.yml']
missing=[x for x in required if not Path(x).exists()]
if missing: raise SystemExit('Missing: '+', '.join(missing))
js=Path('src/main.js').read_text().lower()
for forbidden in ['hhh','bbb','hhb','bbh','mm20','marteau','avalement']:
    if forbidden in js:
        raise SystemExit(f'Hardcoded strategy term found in runtime: {forbidden}')
print('ALTITUDE OS: files/runtime checks OK')
PY
