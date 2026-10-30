#!/bin/sh
# Switches this machine to the TDS Factory in this checkout, including uncommitted changes.
# Removes the globally installed official Release first, then installs a pack of this checkout and its skills.
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

say() { printf '==> %s\n' "$1"; }

say 'Packing this checkout'
tgz=$(cd "$repo" && npm pack --silent --pack-destination "$tmp")

say 'Removing the installed tds-factory'
npm uninstall -g tds-factory

say 'Installing the repo version'
npm install -g "$tmp/$tgz"

say 'Installing skills and agents (--force: replaces the official version of the skills)'
tds-factory install --force

say "Now using the repo version: tds-factory $(tds-factory --version)"
