# Azure DevOps fixtures

Recorded output of `az repos pr show` (`*.pr.json`) and `az repos pr policy list` (`*.policies.json`) for pull requests created in the sandbox repository `Kahoot` (project `Projects`) on 2026-11-01 with `az` 2.90.0 and the `azure-devops` extension. Names, e-mail addresses, organisation, tenant and identity ids are replaced; commit ids, dates and states are as recorded.

| Fixture           | Pull request                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `passing`         | active, merge succeeded, one approved "Comment requirements" policy                                                                                                                              |
| `review-required` | active, "Minimum number of reviewers" policy `queued`, the creator's own vote of 10 that the policy does not count                                                                               |
| `failing-policy`  | **not recorded as is**: `passing` with the policy status changed to `rejected` (a build policy would need a pipeline, which the sandbox does not have, and no real rejected policy was recorded) |
| `conflicts`       | active, `mergeStatus` `conflicts` (add/add on one file)                                                                                                                                          |
| `draft`           | active, `isDraft` true                                                                                                                                                                           |
| `completed`       | status `completed`                                                                                                                                                                               |
| `abandoned`       | status `abandoned`, no `mergeStatus`                                                                                                                                                             |

Do not record fixtures from any other repository.
