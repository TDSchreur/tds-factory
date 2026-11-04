### Added

- The Dashboard serves a Linked document of a Run (`GET /documents/<project>/<run>/<path>`): only a `.md` path listed in that Run's `spec_link` or `tickets`, read from the Run worktree, then the main checkout, then `docs/specs/archive/` for the Spec. Every refusal is the same 404.
