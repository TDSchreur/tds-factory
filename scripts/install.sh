#!/bin/sh
# Installs the latest TDS Factory Release and its skills. Safe to run again to update.
#   curl -fsSL https://github.com/TDSchreur/tds-factory/releases/latest/download/install.sh | sh
# Where the skills go is chosen on your terminal, or named without one, as arguments or as environment variables (not both):
#   curl -fsSL .../install.sh | sh -s -- --agent claude,codex --claude-dir ~/.claude-work
#   TDS_FACTORY_AGENT          the value of `tds-factory install --agent` (claude, codex, copilot, a comma list or all)
#   TDS_FACTORY_CLAUDE_DIR     Claude folders separated by ':', each passed as --claude-dir (an empty entry is an error)
#   TDS_FACTORY_REUSE=1        pass --reuse-selection to repeat the saved choice
# The script checks none of these beyond that; `tds-factory install` validates them before it changes anything. The question
# is asked on the controlling terminal by the CLI, never on standard input, which holds this script under `curl | sh`.
# Other options, as environment variables:
#   TDS_FACTORY_FORCE=1        run `tds-factory install --force` (replaces edited agent files and skills, and same-named skills that tds-factory did not install)
#   TDS_FACTORY_SKIP_SKILLS=1  only install the CLI, do not run `tds-factory install`
set -eu

URL='https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz'
MIN_NODE=24

say() { printf '==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

# The CLI asks on the controlling terminal. Without one, or when the answer is cancelled or refused, the skills are not
# installed, but the CLI already is, so say how to continue.
install_skills() {
  tds-factory install "$@" || die "the skills were not installed (the CLI is). Run 'tds-factory install' in a terminal, or add --agent claude,codex, to choose where they go."
}

# Everything runs inside main, called on the last line, so a download cut off halfway never runs a shortened command.
main() {
  # The destination flags are settled before npm runs, so a conflict installs nothing. The variables become the positional
  # parameters, which main then passes on as they are; nothing is validated here.
  agent=${TDS_FACTORY_AGENT:-}
  dirs=${TDS_FACTORY_CLAUDE_DIR:-}
  reuse=${TDS_FACTORY_REUSE:-}
  [ "$reuse" = 1 ] || reuse=
  if [ -n "$agent$dirs$reuse" ]; then
    [ "$#" -eq 0 ] || die 'give the destinations as arguments or as TDS_FACTORY_AGENT, TDS_FACTORY_CLAUDE_DIR and TDS_FACTORY_REUSE, not both. Nothing was installed.'
    case $dirs in
      :* | *: | *::*) die 'TDS_FACTORY_CLAUDE_DIR has an empty entry; separate the folders with a single ":". Nothing was installed.' ;;
      *) ;;
    esac
    [ -z "$reuse" ] || set -- --reuse-selection
    [ -z "$agent" ] || set -- "$@" --agent "$agent"
    old_ifs=$IFS
    IFS=:
    set -f
    for dir in $dirs; do set -- "$@" --claude-dir "$dir"; done
    set +f
    IFS=$old_ifs
  fi

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
    install_skills --force "$@"
  else
    say 'Installing skills and agents'
    install_skills "$@"
  fi

  say "Done: tds-factory $(tds-factory --version)"
  echo "Next: run 'tds-factory doctor' in a project, then read https://github.com/TDSchreur/tds-factory/blob/main/docs/usage.md"
}

main "$@"
