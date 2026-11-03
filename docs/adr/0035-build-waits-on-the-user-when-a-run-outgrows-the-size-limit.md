# Build waits on the user when a Run outgrows the size limit

> Extends [ADR 0023](0023-check-loops-are-cut-by-sweep-and-checklist-not-by-gates.md): the size limit is no longer only a warning at the transition to Check.

[ADR 0023](0023-check-loops-are-cut-by-sweep-and-checklist-not-by-gates.md) made the size limit (about 40 KB of diff or 15 files) a warning at `run transition --to check`, because the estimate is a judgement. In practice the warning comes when all the code is written, so nobody splits, and it counts lockfiles and recorded test fixtures that no reviewer reads.

**Measure what reviewers read.** The Run size is the diff of committed work against `base_sha`, in files and bytes, without lockfiles and files under `test/fixtures/`. Tests count. The limits do not change.

**Check during Build, decide with the user.** When `run update` raises `tickets_done`, the Factory measures the Run size. Over the limit with Tickets remaining, the update still succeeds and the Run becomes `waiting` on the user. The Factory does not choose between the answers: the user splits (`run split`: the Tickets not yet done leave the Run and open on the tracker, the Run goes on to Check, and the agent starts a new Run for them) or accepts the size (`run size --accept`: the Event log records it and this Run waits for size no more). Like `run track`, the commands are for the agent only after the user answered; this is a rule in the Skill, as for the extra Check loop in [ADR 0024](0024-the-user-can-grant-an-extra-check-loop.md).

**Why a wait and not a refusal.** The estimate is still a judgement, and a refused `run update` would lose the record of a finished Ticket. A wait keeps the work, uses the existing waiting machinery and its Event log entries ([ADR 0021](0021-run-record-model-last-seen-and-event-log.md)), and leaves the decision to the user, who may know that a large generated or mechanical diff is fine.

**What is recorded.** `size_accepted` is a gated field like `extra_loops`: `run update` refuses it, and only the named operation sets it ([ADR 0006](0006-run-progress-goes-through-named-transitions.md)). The `split` and `size-accepted` events are in the Event log. As in ADR 0024, a compliant agent cannot decide for the user by the usual commands, but one that ignores its Skill or edits `run.json` can; the events make that visible afterwards. The transition to Check keeps its warning, silent after an accept.

**Dashboard.** Split and Continue buttons on a Run waiting for size call write routes under [ADR 0017](0017-dashboard-write-routes-need-origin-host-and-a-session-token.md); after a split the Run waits for an agent ([Spec](../specs/dashboard-split-and-continue-buttons.md)).

**Define.** Define puts the estimate per Ticket in the Spec and proposes a split before Build (see the [Spec](../specs/run-size-gate-b.md)).
