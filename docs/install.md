# Install the Factory

This guide takes you from nothing to a working `/factory` in GitHub Copilot. Claude Code and Codex differ only in the places noted.

## 1. What you need

| You need | Check it with | Notes |
|---|---|---|
| Node 20 or newer | `node --version` | Installs from nodejs.org, your package manager or nvm. |
| git | `git --version` | The Factory works in git worktrees, so the project must be a git repository with an `origin` remote. |
| GitHub CLI, signed in | `gh auth status` | Tickets and pull requests go through `gh`. Sign in with `gh auth login`. |
| One coding agent | | GitHub Copilot (VS Code or the Copilot CLI), Claude Code or Codex. |

## 2. Install the Factory

One command installs it, on macOS, Linux and Windows (PowerShell):

```sh
npm install -g https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz
```

Check it worked:

```sh
tds-factory --version
```

That prints a version such as `0.1.12`. If it says the command is not found, see [Troubleshooting](#troubleshooting).

## 3. Install the skills into your agent

The Factory is a set of skills. Install them with:

```sh
tds-factory install
```

This copies the skills into `~/.claude/skills` and `~/.agents/skills` and prints one `installed` line per skill. GitHub Copilot reads both folders, so for Copilot this one command is enough.

To install for one agent only, use `--agent`:

```sh
tds-factory install --agent copilot
```

| Agent | Folder `tds-factory install --agent <name>` writes to |
|---|---|
| `copilot` | `~/.copilot/skills` |
| `claude` | `~/.claude/skills` |
| `codex` | `~/.agents/skills` |
| `all` (the default) | Claude and Codex folders, which Copilot also reads |

Add `--project` to install into the current project instead of your home folder. It never overwrites a skill folder it did not create; `--force` does.

### Check that your agent sees the skills

- **GitHub Copilot in VS Code:** open the chat and type `/`. The list should include `factory`. Type `/skills` to open the skills menu. Restart VS Code if the list is empty.
- **Copilot CLI, Claude Code and Codex:** start a new session after installing, so the agent reads the skills folder again, then type `/factory`.

## 4. Update

Run the install command from part 2 again, then refresh the skills:

```sh
npm install -g https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz
tds-factory install
```

`tds-factory --version` shows what you now have. A new version is published for every change merged to the Factory, so updating now and then is enough. Skills are never updated by `npm install` alone; `tds-factory install` does that.

## 5. Prepare a project

Do this once per project you want to build with the Factory.

1. Open the project in your agent. It must be a git repository with an `origin` remote on GitHub, and `gh repo view` must print the repository.
2. Run `/setup-matt-pocock-skills` in the chat. In Copilot, type `/` and choose it; this skill only runs when you start it yourself. It asks where issues live (choose GitHub) and where the domain docs live (keep `GLOSSARY.md` and `docs/adr/`). It writes `docs/agents/issue-tracker.md`, `docs/agents/domain.md` and an `## Agent skills` section in `AGENTS.md`.
3. Add a `## Commands` section to `AGENTS.md` with the command that checks the project, for example `- Verify: npm test`. If it is missing, `/factory` asks you once.
4. Add `.factory/` to the project's `.gitignore`. That folder holds Run records and Run worktrees, and must not end up in commits.
5. Make sure the label `ready-for-agent` exists in the repository's GitHub Issues. If it does not, the agent asks before it creates it.

Commit the new files. Now `/factory` can start.

## Troubleshooting

**`tds-factory: command not found` (or "not recognized").** The folder where npm puts global commands is not on your PATH. Find it with `npm prefix -g`, add its `bin` folder (on Windows the folder itself) to PATH, and open a new terminal.

**`EACCES: permission denied` while installing.** npm cannot write to its global folder. Install into your home folder instead, and put `~/.local/bin` on your PATH:

```sh
npm install -g --prefix ~/.local https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz
```

**`404 Not Found` on the install URL.** The Factory repository is not public yet, or no Release exists. Ask the maintainer.

**`EBADENGINE` warnings or syntax errors on start.** Your Node is too old. Check `node --version` and upgrade.

**`skip ...: exists and was not installed by tds-factory`.** A skill with the same name is already in that folder, from another tool. Rename or remove it, or run `tds-factory install --force` to replace it.

**`/factory` does not appear in the chat.** Run `tds-factory install` again, then start a new chat session or restart the editor. In Copilot, `/skills` shows what it loaded.

**`/factory` stops at Preflight.** The project is not prepared. Do part 5.

**`tds-factory run start` fails with an error about `origin`.** The project has no reachable `origin` remote, or no commit yet. Fix the remote or make a first commit.
