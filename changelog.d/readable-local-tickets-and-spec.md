### Added

- The Dashboard serves a Linked document of a Run (`GET /documents/<project>/<run>/<path>`): only a `.md` path listed in that Run's `spec_link` or `tickets`, read from the Run worktree, then the main checkout, then `docs/specs/archive/` for the Spec. Every refusal is the same 404.

### Changed

- A Spec or Ticket of a Local tracker is now a link in the Dashboard's Run detail and on the Ticket tiles: the file name is the text, the path the tooltip, and a click opens the document as Markdown in the Run detail with a Back button.
