### Fixed

- `tds-factory doctor` and `tds-factory run start` no longer hang for 20 seconds when origin needs a login that Git Credential Manager would ask for in a browser or dialog; the git check now fails at once, and a timeout says what to check.
