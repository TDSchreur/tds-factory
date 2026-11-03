# Pin the waitUntil deadline test to the exact deadline

The `waitUntil` test "checks once more at the deadline" in `test/wait-until.test.js` scripts `Date.now` so the second reading leaves 10 ms of 20, which passes for any helper that checks after its last wait, and the scripted value 20 is never read. A second test now scripts the readings 0, 10 and 20 ms with a condition that is never true and asserts that the helper rejects after exactly two checks: the one made when the deadline is reached, and none after it. A helper that stopped checking at the deadline, or kept polling past it, fails one of the two tests. Production code is unchanged, and there is no new public interface, schema or dependency.

Documents: `changelog.d/pin-waituntil-deadline-test.md`. No canonical spec or guide describes the helper's deadline check.
