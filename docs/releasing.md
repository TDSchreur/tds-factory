# Publishing a Release

Publish when a useful group of changes is ready for colleagues; merges to `main` do not publish automatically. Confirm the changes you want are merged to `main` and that the major and minor version in `package.json` are appropriate. Raise either there through a PR when needed; the workflow chooses the next patch number automatically.

1. On GitHub, open the repository's **Actions** tab and select the **release** workflow.
2. Select **Run workflow**, choose `main`, and select **Run workflow** again. The release job only runs on `main`.
3. Open the workflow run and check that it succeeds. Read-only jobs run the main suite on Node 20 and the latest LTS, plus mandatory browser tests. The publishing job waits for these checks, packs the release, and tests that exact tarball by installing the CLI and each Agent target into temporary directories. A failure prevents publication. Inspect the failed step, fix the problem and run the workflow again.
4. Open **Releases** and check that the new version is marked Latest, the generated notes cover the intended changes, and its four assets are attached: `tds-factory.tgz`, `tds-factory.tgz.sha256`, `install.sh` and `install.ps1`. Colleagues install with the one-line commands in the README or the [install guide](install.md), and update with `tds-factory update`.

Never create a Release by hand (for example with `gh release create` or the GitHub UI): without all four assets it becomes Latest and the README install commands return 404. The release workflow ends by downloading each asset URL and comparing it with the file it built, and the `latest-release` workflow checks the same four URLs daily and whenever a Release changes, so a Latest Release without one of them shows up as a failed run.

The release is built from the `main` commit selected when the workflow starts. Changes merged afterwards will be included in a later release. Avoid triggering another release until there are changes worth publishing.
