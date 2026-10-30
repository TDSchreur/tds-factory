# Freeze project reviews per Run

The project-review design adds project-supplied Check axes alongside the Factory's baseline reviews. Each Run captures its project review configuration and the referenced Skills with their bundled instructions when it starts; older Runs retain their baseline axes. This keeps review requirements stable and prevents configuration edits or installed Skill updates from silently changing which reviews must pass midway through a Run.

Reading live configuration and Skills at each Check would make updates immediately available, but could remove required reviews or change their meaning after Evidence was collected. Freezing them costs storage and means updates apply to new Runs. Runtime dependencies and browser capabilities remain prerequisites to check explicitly, rather than resources the snapshot promises to reproduce.

See [the project reviews Spec](../specs/project-reviews.md).
