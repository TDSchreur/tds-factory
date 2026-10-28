# Unslop PR descriptions

## Problem Statement

When I finish a Run, the Factory drafts the pull request with the `pr` Skill. The result follows the template, but the prose reads like generated text: filler phrases, inflated vocabulary, em dashes, "not just X but Y" constructions. I have to rewrite it by hand before I can post it, or I post it as it is and reviewers skim past it.

## Solution

The Finish Stage runs the `unslop` Skill over the PR title and the prose of the PR body, right after `pr` drafts them. Diagrams, diffs, code blocks, the Evidence output and the template's bold labels stay untouched. The cleaned text is what gets saved as `pr.md`, so the draft I approve is already readable.

## User Stories

1. As a developer running the Factory, I want the PR title and body cleaned of AI writing patterns, so that I can post the pull request without rewriting it
2. As a developer, I want the cleanup to happen in the Finish Stage right after `pr` drafts the text, so that the draft I review is the final one
3. As a developer, I want `pr.md` in the Run folder to hold the cleaned text, so that what I read there is what gets pushed
4. As a developer, I want only the PR title and the prose of the body rewritten, so that the template keeps its structure
5. As a developer, I want diagrams, diffs, code blocks and Evidence output left exactly as drafted, so that the cleanup never changes a fact or a snippet
6. As a developer, I want the template's bold labels (Door, Blast Radius, Before, After) kept, so that the cleanup does not strip the template's structure
7. As a developer, I want commit messages and Ticket bodies left alone, so that the change stays scoped to the pull request
8. As a developer, I want `unslop` callable by the model during a Run, so that the Finish Stage can invoke it without me typing a command
9. As a maintainer, I want `sync` to unflag `unslop` automatically, so that no local patch to the vendored copy is needed
10. As a maintainer, I want the `pr` Skill left as the synced upstream copy, so that a re-sync never overwrites our change
11. As a maintainer, I want the skills test to list `unslop` among the invoked Skills, so that dropping the step from Finish fails the build

## Implementation Decisions

- The `factory` Skill's Finish Stage gains a second invocation, written as ``Invoke `unslop` ``, after the existing `Invoke `pr``. The wording says it applies to the PR title and the prose of the body only, and names what is exempt: diagrams, diffs, code blocks, Evidence output and the template's bold labels.
- Finish keeps saving the draft as `pr.md` in the Run folder; the saved text is the cleaned text.
- The `pr` Skill is not edited. It is a synced copy of upstream and the next `sync` would overwrite a change.
- `sync` already removes `disable-model-invocation` from every Skill the `factory` Skill invokes. Adding the invocation is enough to unflag `unslop`. No new sync mechanism is built.
- After the change, `sync` and `install` are re-run so the committed `unslop` copy and the installed copies reflect it.
- Commit messages and Ticket bodies are out of scope; only the PR title and body are cleaned.

## Testing Decisions

- A good test checks external behavior: which Skills the Flow invokes and whether the model can call them. It does not check the wording of a Stage.
- The single seam is the existing skills test over the `factory` Skill. It already collects the Skills the Flow invokes and asserts the exact list, and asserts that none of them carries the model-invocation flag.
- `unslop` is added to the expected list. The existing "can be called by the model" test then covers the flag for `unslop` with no new test.
- Prior art: the two existing tests in the skills test file.

## Out of Scope

- Editing the `pr` Skill or its template.
- Running `unslop` on commit messages, Ticket bodies, Spec files or Stage summaries.
- Changing `unslop`'s rules.
- Any change to `sync`.

## Further Notes

- `unslop` rules 15 and 16 (bold overuse, inline-header lists) would otherwise rewrite the template's bold labels, which is why Finish names them as exempt.
