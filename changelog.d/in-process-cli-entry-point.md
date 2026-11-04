### Changed

- The CLI's commands run through an in-process entry point, `main(argv, context)`, that `bin/tds-factory.js` calls. Nothing changes for users. The unit tests use it through `test/cli-runner.js` instead of starting a process for every CLI call, which cuts the CPU time of `npm run test:unit` to about a third.
- `tds-factory` reports an unknown option as `error: ...` with exit code 1, like other errors, instead of a Node stack trace.
