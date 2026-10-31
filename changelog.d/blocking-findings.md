### Changed
- Check sends a Run back to Build only for a Blocking finding: a violation of a documented standard, a CRITICAL, HIGH or MEDIUM security, infrastructure or project review finding, or a Spec requirement that is missing or wrong. LOW and INFO items, code smells and style judgement are Left open: they are listed but never cause a Rework. Reviewers report a severity and the standard or requirement behind each finding.
- The Dashboard help text for Check and for the Reworks chip says Blocking findings, and the pull request description gets a "Left open" section.
