# Publishing a Release

Publish when a useful group of changes is ready for colleagues; merges to `master` do not publish automatically. Confirm the changes you want are merged to `master` and that the major and minor version in `package.json` are appropriate. Raise either there through a PR when needed; the workflow chooses the next patch number automatically.

1. On GitHub, open the repository's **Actions** tab and select the **release** workflow.
2. Select **Run workflow**, choose `master`, and select **Run workflow** again. The release job only runs on `master`.
3. Open the workflow run and check that it succeeds. It runs the tests before packing and publishing; a failure prevents publication. Inspect the failed step, fix the problem and run the workflow again.
4. Open **Releases** and check that the new version is marked Latest, the generated notes cover the intended changes, and `tds-factory.tgz` is attached. Colleagues can install or update using the unchanged command in the README or the [install guide](install.md).

The release is built from the `master` commit selected when the workflow starts. Changes merged afterwards will be included in a later release. Avoid triggering another release until there are changes worth publishing.
