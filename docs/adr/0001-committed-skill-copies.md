# Ship committed copies of skills; submodules are only the sync source

The upstream skill repos (mattpocock/skills, ponytail, pstack) are pinned as git submodules in `vendor/`. A `sync` command copies the skills listed in `skills.manifest.json` into `skills/`, which is committed and is the only thing `install` reads. We chose this over installing straight from the submodules so that shipped skills are reviewable in diffs, installs work offline, and we can patch or add our own skills (such as `factory`) next to the upstream ones.
