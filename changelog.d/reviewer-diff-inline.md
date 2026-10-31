### Changed
- Check passes the diff against the base, the changed file list and the Verify summary inline to each reviewer, so the read-only reviewers no longer rediscover the change with many tool calls. Reviewers open other files only to follow a reference; a diff larger than about 40 KB is passed as the file list plus per-file diffs up to that size, with the left-out files named.
