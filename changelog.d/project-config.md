### Added
- An optional committed `.factory/config.json` sets the model per Stage, a Check loop cap (never above 4), the Ticket label and extra Project reviews, without editing agent files or running `install --force`. `tds-factory doctor` validates it and names the line to fix, a Run freezes it, and `tds-factory run config` prints it. `.factory/reviews.json` keeps working.
