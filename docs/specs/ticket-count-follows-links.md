# Ticket count follows the Ticket links

## Problem Statement

`tickets_total` in the Run record is a second copy of the number of Ticket links in `tickets`, and nothing keeps the two equal. The factory Skill never tells the agent to set `tickets_total`, so an agent that records the Tickets leaves it at 0. `run transition --to build` only checks that `tickets` is not empty, so the mistake surfaces late: `--to check` refuses with "Check needs every Ticket done (1 of 0)". Separately, PR #494 left one constant in the Azure PR code, `MERGE_STRATEGY_POLICY`, whose name does not say that it holds a policy type id.

## Solution

`run update` keeps `tickets_total` equal to the number of Ticket links: setting `tickets` sets the count, and a count that disagrees with the list is refused with a message that names both numbers. The Skill and the Run record schema say that the count follows the links. The constant is renamed `MERGE_STRATEGY_POLICY_TYPE_ID`.

## User Stories

1. As an agent recording the Tickets, I want `tickets_total` to follow the list I set, so that I never have to remember a second field.
2. As an agent, I want `tickets` set again later (a Ticket added or dropped) to update the count too, so that the record stays right after Rework.
3. As an agent, I want a `tickets_total` that does not match the list to be refused at once, so that I do not find out at `--to check`.
4. As an agent, I want the refusal to read "tickets_total (N) does not match the M Tickets", so that I see which number to fix.
5. As an agent, I want a `tickets` list shorter than `tickets_done` to be refused, so that the record never says more Tickets are done than exist.
6. As an agent, I want `tickets_total` set together with a matching `tickets` to keep working, so that existing calls do not break.
7. As an agent, I want `tickets_total` set alone, before any list exists, to keep working, so that Runs without links stay possible.
8. As an agent reading the factory Skill and the schema, I want to be told that the count follows the Ticket links, so that I do not set it by hand.
9. As a maintainer, I want the Azure policy constant named for what it holds, so that the check that skips it reads clearly.
10. As a maintainer, I want the rename to change no behavior, so that the Dashboard's Azure checks stay as they are.

## Implementation Decisions

- The Run record's update operation derives the count: when `tickets` is in the update, the new `tickets_total` is its length.
- When `tickets_total` is also in the update, it must equal the list length; otherwise the update is refused with "tickets_total (N) does not match the M Tickets".
- When `tickets_total` is set alone and the stored record already has a list, it must equal that list's length, same message. With no list yet, any valid number is accepted.
- The new list must not be shorter than the `tickets_done` that results from the update (the stored value, or the one in the same update); otherwise the update is refused with a message naming both numbers.
- Only `run update` changes. Transition, repair and sync rules are unchanged, and `run transition --to build` still checks only that `tickets` is not empty.
- The factory Skill's Update paragraph and the `tickets_total` and `tickets` rows of the Run record schema say that the count follows the Ticket links and need not be set.
- The constant `MERGE_STRATEGY_POLICY` in the Azure PR provider becomes `MERGE_STRATEGY_POLICY_TYPE_ID`; its value and use do not change.
- No ADR and no glossary change. The installed copies of the Skill are refreshed by `tds-factory install`, which is not part of this work.
- A changelog fragment is added, because `src/` and `skills/` change.

## Testing Decisions

- A good test drives the external behavior: the `tds-factory run update` command against a real Run store, then reads `run.json` or the refusal message. It does not call the validation helpers.
- Seam: the CLI against a temporary project with a Run, as used by the existing `run update` tests in `test/run-gates.test.js` (its `run`, `update` and `file` helpers). One seam covers all rules.
- Cases: `tickets` alone sets the count; `tickets` set again changes it; matching `tickets` and `tickets_total` together; mismatching together is refused; `tickets_total` alone with a list and a wrong number is refused; with no list it is accepted; a list shorter than `tickets_done` is refused; the refusal leaves the record unchanged.
- Existing tests that set `tickets` and `tickets_total` together stay valid; any that set a mismatching pair are corrected in the same Ticket.
- The rename needs no new test: the existing Azure PR tests (`test/pr-azure*.test.js` and the Dashboard checks) still pass, and the Skill and doc checks in `npm test` cover the documents.
- Prior art: `test/run-gates.test.js`.

## Out of Scope

- Making `run transition --to build` check the count, or any change to other transitions.
- Changing how `tickets_done` is set.
- Running `tds-factory install` or changing how installed Skill copies are refreshed.
- Repairing old Run records whose count and list disagree.
- Other renames in the Azure PR code.

## Further Notes

Documents: `skills/factory/SKILL.md` (the Update paragraph), `skills/factory/references/run-schema.md` (rows `tickets_total` and `tickets`), `src/run-lifecycle.js` (`updateRun`), `src/run-record.js` (validation and apply), `src/pr-azure.js` (the constant), and a fragment in `changelog.d/`. The Term sweep for `tickets_total` and `tickets_done` found no other current document, canonical spec or help text; `docs/usage.md`, `docs/development.md` and the glossary do not mention them, and the sweep for `MERGE_STRATEGY_POLICY` found no document outside the code. The related earlier Spec is `docs/specs/azure-merge-strategy-policy-not-a-check.md`.

## Tickets

1. **Ticket count follows the links:** the update rules, the Skill and schema text, the tests and the changelog fragment.
2. **Rename the policy type id constant:** `MERGE_STRATEGY_POLICY_TYPE_ID` in the Azure PR provider.
