### Fixed

- The browser tests no longer leave a half-deleted Chromium profile behind on a loaded machine, which made
  `test/dashboard-teardown-browser.test.js` fail in about 3 of 5 full `npm test` runs. `openPage().close()` now lets
  Chromium exit before ChromeDriver deletes the profile.
