### Added
- The factory Skill and all Stage agents of every Agent target state that a Run follows the Flow through: detailed instructions do not replace Define, no Stage is skipped, a refused transition is not worked around and `run.json` is not edited directly.
- Eval scenarios `small-task-define` and `refused-transition`.
- `tds-factory run inspect` reports `stage-skipped` for a Run still in Define whose branch changes project files.
