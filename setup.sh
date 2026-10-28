#!/bin/sh
# Register the tds-factory CLI on PATH from this checkout.
set -eu

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "error: Node 20 or newer and npm are required" >&2
  exit 1
fi

major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 20 ]; then
  echo "error: Node 20 or newer is required (found $major)" >&2
  exit 1
fi

npm install -g .

if ! command -v tds-factory >/dev/null 2>&1; then
  echo "warning: tds-factory is installed but not on your PATH; add $(npm prefix -g)/bin to it" >&2
fi

echo
echo "Done. Next, install the skills: tds-factory install"
