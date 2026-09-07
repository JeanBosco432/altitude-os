#!/bin/bash
cd "$(dirname "$0")"
PORT=8080
python3 -m http.server "$PORT"
