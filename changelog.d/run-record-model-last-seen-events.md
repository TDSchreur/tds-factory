### Added
- The Run record has `requested_model`, `requested_effort`, `observed_model` and `last_seen`, and each Run folder keeps an append-only `events.jsonl` (Stage changes, Tickets done, Verify start and finish with duration, waits, releases and Reworks). `/api/views` returns `model`, `lastSeen`, `events` and `eventsDamaged`. See ADR 0021.

### Changed
- The factory Skill tells agents to report `requested_model`, `requested_effort` and `observed_model` once per Stage and to update `activity` often.
