### Changed

- The browser tests wait for a poll of the Dashboard instead of sleeping 2.2 to 2.5 seconds: `openPage()` takes a `pollMs` option and `page.waitForPolls()` waits for the poll itself. The Dashboard does not change. `npm run test:browser` is faster.
