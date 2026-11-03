### Changed

- `tds-factory` starts faster: it loads the code of a command only when it runs that command, and keeps compiled code in Node's compile cache.

### Fixed

- Running the eval grader no longer adds `factory-eval-*` projects to the Project registry or leaves folders in the temp directory.
- The unit tests finish sooner: the slowest test files are split so they run side by side, the eval harness tests run concurrently, and test repositories are copied instead of built with three git commands each.
