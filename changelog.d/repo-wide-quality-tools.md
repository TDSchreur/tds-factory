### Added

- `npm run check` runs lint, format check and typecheck in one go; an `.editorconfig` matches the Prettier settings.

### Changed

- Prettier now formats and checks JavaScript, JSON, Markdown and YAML across the repository, with the formatting commits listed in `.git-blame-ignore-revs`.
- ESLint also enforces `eqeqeq`, `prefer-const`, `no-var` and `no-shadow`.
- `tsconfig.json` covers every JavaScript folder; files opt in to typechecking with `// @ts-check`, and eleven more small modules now do.
