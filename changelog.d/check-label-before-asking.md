### Fixed
- The Factory Skill and the install guide now say how to check for a needed label: `gh label list --search <name> --json name`, matching the exact name. The agent asks the user only when the label is absent and treats "already exists" from `gh label create` as present, so it no longer asks for a label the repository already has.
