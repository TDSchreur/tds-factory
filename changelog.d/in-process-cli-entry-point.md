### Changed

- The CLI's commands run through an in-process entry point, `main(argv, context)`, that `bin/tds-factory.js` calls. Nothing changes for users; the unit tests use it to run the CLI without starting a process for every call.
