### Changed

- tds-factory needs Node 24.4 or newer (`engines.node` is `>=24.4`, and CI and the release workflow test `24.4` and the latest LTS). The code uses `import.meta.dirname`, `import.meta.main`, `fs.mkdtempDisposableSync` with `using`, `events.once`, `timers/promises`, `findLast` and `fs.globSync` in place of the hand-written versions; behaviour is unchanged.
