#!/bin/sh
# Installs the latest TDS Factory Release and its skills. Safe to run again to update.
#   curl -fsSL https://github.com/TDSchreur/tds-factory/releases/latest/download/install.sh | sh
# Options, as environment variables:
#   TDS_FACTORY_FORCE=1        run `tds-factory install --force` (replaces edited agent files and skills, and same-named skills that tds-factory did not install)
#   TDS_FACTORY_SKIP_SKILLS=1  only install the CLI, do not run `tds-factory install`
set -eu

URL='https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz'
MIN_NODE=20

say() { printf '==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

# Everything runs inside main, called on the last line, so a download cut off halfway never runs a shortened command.
main() {
  command -v node >/dev/null 2>&1 || die "node not found. Install Node $MIN_NODE or newer from https://nodejs.org and run this again."
  command -v npm >/dev/null 2>&1 || die "npm not found. It comes with Node: install Node $MIN_NODE or newer from https://nodejs.org and run this again."
  node_major=$(node -p 'process.versions.node.split(".")[0]') || die 'could not read the Node version'
  [ "$node_major" -ge "$MIN_NODE" ] 2>/dev/null || die "Node $(node --version) found, need $MIN_NODE or newer. Upgrade from https://nodejs.org and run this again."

  say 'Installing tds-factory with npm'
  log=$(mktemp)
  trap 'rm -f "$log"' EXIT
  status=0
  npm install -g --allow-remote=root "$URL" >"$log" 2>&1 || status=$?
  cat "$log"
  if [ "$status" -ne 0 ]; then
    if grep -q EACCES "$log"; then
      cat >&2 <<'MSG'

error: npm cannot write to its global folder (EACCES). Do not use sudo. Either:
  - install into your home folder (the prefix setting also keeps later updates working) and put ~/.local/bin on your PATH:
      npm config set prefix ~/.local
      npm install -g --allow-remote=root https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz
      tds-factory install
  - or install Node with nvm (https://github.com/nvm-sh/nvm), which keeps npm's folder in your home, and run this again.
MSG
      exit 1
    fi
    die "npm install failed (exit $status); see the output above."
  fi
  command -v tds-factory >/dev/null 2>&1 || die "installed, but tds-factory is not on your PATH. Run 'npm prefix -g', add its bin folder to PATH, open a new terminal and run 'tds-factory install'."

  if [ "${TDS_FACTORY_SKIP_SKILLS:-}" = 1 ]; then
    say 'Skipping skills install (TDS_FACTORY_SKIP_SKILLS=1)'
  elif [ "${TDS_FACTORY_FORCE:-}" = 1 ]; then
    say 'Installing skills and agents (--force: edited agent files and skills, and same-named skills that tds-factory did not install, are replaced)'
    tds-factory install --force
  else
    say 'Installing skills and agents'
    tds-factory install
  fi

  say "Done: tds-factory $(tds-factory --version)"
  echo "Next: run 'tds-factory doctor' in a project, then read https://github.com/TDSchreur/tds-factory/blob/master/docs/usage.md"
}

main "$@"
