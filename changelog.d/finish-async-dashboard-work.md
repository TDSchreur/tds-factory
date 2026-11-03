### Fixed

- The origin lookup no longer reports a `maxBuffer` overflow as "origin did not answer within 20s"; `gitAsync` marks a real timeout with `timedOut`.
- A second Dashboard action (accept, sync, clean, delete, extra loop or merge) on a Run that is already busy is answered 409 "another action on this Run is already running"; the guard belongs to one Dashboard.
- When the compensating update after a failed accept fails, the cause goes to stderr and the answer keeps the original error.
