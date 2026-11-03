### Added

- Check PR for an Azure DevOps pull request lists the failing and pending checks (build policies and statuses posted to
  the PR) and the unresolved review threads, as it does for GitHub. The status line counts the PR statuses as checks
  too.
- Follow-up works for an Azure DevOps pull request: `tds-factory run follow-up --scope conflicts|checks|comments`,
  `/factory continue <run id>` and the Dashboard buttons **Fix conflicts**, **Fix checks**, **Fix comments** and
  **Grant extra loop and fix** behave as for GitHub. The Factory still never writes to Azure DevOps: it posts no reply and
  resolves no thread.

### Changed

- `tds-factory run follow-up` no longer says "Follow-up needs a GitHub PR URL"; the Dashboard Fix refusal for a host
  without an adapter names GitHub and Azure DevOps.
- The text of a failed `gh` or `az` command that reaches an error is capped at 500 characters, with control characters
  replaced by spaces.
