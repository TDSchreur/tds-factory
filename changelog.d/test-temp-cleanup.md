### Fixed
- `npm test`, `npm run test:unit`, `test:browser`, `test:package` and `npm run eval` no longer leave thousands of folders in the temp directory. Each run now gets its own temporary directory, which is removed when the command ends. One unit-test run used to leave about 32,000 inodes behind.
