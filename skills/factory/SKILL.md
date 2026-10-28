---
name: factory
description: Run the TDS software factory flow (Define, Prepare, Build, Check, Finish) to take a piece of work from idea to pull request. Use when the user says "factory" or wants to build a feature end to end.
disable-model-invocation: true
---

# Factory

Walk the work through the Stages below in order. Finish each Stage and tell the user what it produced before starting the next. The user can stop or redirect at any Stage.

## Define

1. Invoke `grill-with-docs` to settle what has to be done. Update `GLOSSARY.md` and `docs/adr/` as it goes.
2. Invoke `to-spec` to write the Spec as a Markdown file in `docs/specs/`.
3. Invoke `to-tickets` to cut the Spec into Tickets, stored as GitHub Issues.

## Prepare

Invoke `ponytail` so the Build stage writes the minimum code that works.

## Build

Invoke `implement-spec`, working test-first with `tdd`, until every Ticket is done.

## Check

Invoke `code-review` on the changes. If it finds problems worth fixing, go back to Build and fix them, then review again. Go back at most 2 times; after that, report what is still open and continue to Finish.

## Finish

Invoke `pr` to prepare the pull request. Do not push or open it without the user's go-ahead.
