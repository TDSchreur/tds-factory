### Changed

- The browser tests close a page in about 0.1 seconds instead of 5: the helper kills the Chromium processes and waits for them to leave before ChromeDriver deletes the profile, instead of waiting out a deadline for a Chromium that ignores `Browser.close`. `npm run test:browser` is much faster.
