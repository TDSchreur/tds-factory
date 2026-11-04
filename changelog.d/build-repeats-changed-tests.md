### Changed

- The Exit checklist of the Build stage has an eighth step, "Repeat changed tests". For every changed test file or
  helper, Build runs the repeat step of the project's reliable-tests guide (30 runs plain, under load and with
  `--test-concurrency=1`) and sees every new test fail on the code from before the change. Build agents never use
  `run_in_background` or `pkill` for test runs. The three Build agent files, the `factory` Skill, the glossary and the
  canonical Exit checklist spec say the same.
