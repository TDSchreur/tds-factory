### Security

- The development toolchain now resolves `minimatch` 11.0.1 or newer through an npm `overrides` entry, which
  closes Dependabot alert #1 (denial of service through globparts amplification).
