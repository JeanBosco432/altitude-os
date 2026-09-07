#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check src/main.js
python3 - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
class Parser(HTMLParser): pass
p=Parser(); p.feed(Path('index.html').read_text())
required=['index.html','config.js','favicon.svg','src/main.js','src/styles.css','supabase/schema.sql','.github/workflows/deploy-pages.yml']
missing=[x for x in required if not Path(x).exists()]
if missing: raise SystemExit('Missing: '+', '.join(missing))
print('ALTITUDE OS: syntax/files check OK')
PY
