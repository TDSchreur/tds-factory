# Azure DevOps fixtures

Recorded output of `az repos pr show` (`*.pr.json`) and `az repos pr policy list` (`*.policies.json`) for pull requests created in the sandbox repository `Kahoot` (project `Projects`) on 2026-11-01 with `az` 2.90.0 and the `azure-devops` extension. Names, e-mail addresses, organisation, tenant and identity ids are replaced; commit ids, dates and states are as recorded.

| Fixture | Pull request |
| --- | --- |
| `passing` | active, merge succeeded, one approved "Comment requirements" policy |
| `review-required` | active, "Minimum number of reviewers" policy `queued`, the creator's own vote of 10 that the policy does not count |
| `failing-policy` | **not recorded as is**: `passing` with the policy status changed to `rejected` (a build policy would need a pipeline, which the sandbox does not have, and no real rejected policy was recorded) |
| `conflicts` | active, `mergeStatus` `conflicts` (add/add on one file) |
| `draft` | active, `isDraft` true |
| `completed` | status `completed` |
| `abandoned` | status `abandoned`, no `mergeStatus` |
| `merge-strategy` | recorded on 2026-11-03: active, one blocking "Require a merge strategy" policy (squash only) `rejected` because no completion options are set; the policy turned `approved` once squash was chosen. Its policy type id `fa4e907d-c16b-4a4c-9dfa-4916e5d171ab` is the same in every organisation and is kept |

## Threads and statuses

Recorded on 2026-11-03 from one throw-away PR (id 533, source branch `fixture/threads-throwaway`) with `az` and the `azure-devops` extension. The PR was abandoned and its branch deleted afterwards. `sandbox.pr.json` is `az repos pr show`, `sandbox.threads.json` is `az devops invoke --area git --resource pullRequestThreads` and `sandbox.statuses.json` is `--resource pullRequestStatuses`, all read with the project and repository GUIDs (`--route-parameters project=<guid> repositoryId=<guid> pullRequestId=<id> --api-version 7.1`). Ids of the organisation, project, repository, user and tenant, names, e-mail addresses and avatar links are replaced as above; thread, comment and status ids, commit ids, dates and states are as recorded. The PR number 533 is kept in the links.

| Fixture | What it shows |
| --- | --- |
| `sandbox.pr` | the matching `az repos pr show` (active, `repository.id` and `repository.project.id` as placeholders) |
| `sandbox.threads` | recorded: one thread of each status (`active` 1879, `pending` 1880, `fixed` 1881, `closed` 1882, `byDesign` 1883, `wontFix` 1884), threads on a file (1879, 1881 to 1884) and on the whole PR (1880, 1885, 1886); no `continuation_token` |
| `sandbox.statuses` | recorded: statuses `pending`, `failed` (with a `targetUrl`), `error`, `succeeded`, `notApplicable`, and the context `fixture/twice-check` posted twice (`failed` id 6, then `succeeded` id 7); the response is oldest first |
| `sandbox-derived.threads` | **not recorded as is**: system threads (vote, push, policy update; `CodeReviewThreadType` property, `system` comment), a thread with a deleted comment and one whose first comment is deleted and second is not, built from a recorded thread because posting votes, pushes and comment deletions was outside what the sandbox approval covered |
| `failing-build` | **not recorded as is**: `passing` with the policy changed to a "Build" policy `rejected` and a `context` of `buildId` 4242 (the sandbox has no pipeline) |

Do not record fixtures from any other repository.
