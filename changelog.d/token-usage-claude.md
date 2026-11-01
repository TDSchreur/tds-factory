### Added

- `tds-factory run stats --id` shows the tokens a Run used per Stage, model and Ticket, read from the Claude session logs at each Stage change and at completion. The headline is fresh tokens (input plus cache write plus output); cache reads, reviewer subagents, the Build wrap-up and the Rework bucket are shown apart. A Run whose logs cannot be read says `not tracked`; only counts are stored, never conversation text.
