#!/bin/sh
# Switches this machine to the official TDS Factory Release from GitHub.
# Removes the globally installed repo build first, then installs the latest Release and its skills.
set -eu

URL='https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz'

say() { printf '==> %s\n' "$1"; }

say 'Removing the installed tds-factory'
npm uninstall -g tds-factory

say 'Installing the official Release'
npm install -g --allow-remote=root "$URL"

say 'Installing skills and agents (--force: replaces the repo version of the skills)'
tds-factory install --force

say "Now using the official Release: tds-factory $(tds-factory --version)"
