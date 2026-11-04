# The Dashboard reads only the documents a Run record links to

> Extends the read routes next to [ADR 0017](0017-dashboard-write-routes-need-origin-host-and-a-session-token.md) and [ADR 0033](0033-one-dashboard-serves-every-registered-project.md): the Dashboard now reads files of a Project, not only of the Run folder.

Until now the Dashboard read only the Run folder (`/files/<runId>/<name>.md`). A Linked document that is a local path, such as the Spec in `docs/specs/` or a Ticket of a Local tracker in `.scratch/`, showed as plain text, while a GitHub Ticket was a link.

**Decision.** The Dashboard shows a Linked document, rendered as Markdown in the Run detail. The server reads a file only when its path is listed in that Run's `spec_link` or `tickets`, is relative, ends in `.md` and, after resolving symlinks, stays inside the Run worktree or the main checkout. It looks in the Run worktree first, then the main checkout, then, for the Spec, `docs/specs/archive/` under the same file name. Any other path gets a 404.

**Why an allow-list and not a file route.** A general route under the Project would let any page that reaches the local server read any Markdown file of every registered Project. Tying the read to the Run record keeps the surface to the documents the user already sees listed, and needs no new configuration. The cost is that a relative link inside a Linked document does not open in the Dashboard.
