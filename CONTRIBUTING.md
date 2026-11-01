# Contributing

Thanks for helping. Setup, tests and the repository layout are in [docs/development.md](docs/development.md); releases are in [docs/releasing.md](docs/releasing.md).

1. Open or pick a [GitHub issue](https://github.com/TDSchreur/tds-factory/issues) first for anything bigger than a small fix.
2. Branch from `main` and run `npm test` and `npm run check` (lint, format check and typecheck) before you push.
3. Add a changelog fragment in `changelog.d/` for any change to `src/`, `skills/` or `agents/`, and for any other change users will notice (`npm test` checks the first; format in [changelog.d/README.md](changelog.d/README.md)); do not edit `CHANGELOG.md`, which a maintainer assembles at release time.
4. Open a PR. `main` is protected: changes arrive only through a squash-merged PR with signed commits, a linear history and a green `ci-ok` check.
5. Report security problems privately, as described in [SECURITY.md](SECURITY.md).
