# Install the Factory

This guide takes you from nothing to a working `/factory` in GitHub Copilot. Claude Code and Codex differ only in the places noted. When you are ready to start a piece of work, read the [usage guide](usage.md).

## 1. What you need

| You need | Check it with | Notes |
|---|---|---|
| Node 20 or newer | `node --version` | Installs from nodejs.org, your package manager or nvm. |
| git | `git --version` | The Factory works in git worktrees, so the project must be a git repository with an `origin` remote. |
| GitHub CLI, signed in | `gh auth status` | Tickets and pull requests go through `gh`. Sign in with `gh auth login`. |
| One coding agent | | GitHub Copilot (VS Code or the Copilot CLI), Claude Code or Codex. |

## 2. Install the Factory

One line installs the CLI and the skills. On macOS and Linux:

```sh
curl -fsSL https://github.com/TDSchreur/tds-factory/releases/latest/download/install.sh | sh
```

On Windows (PowerShell):

```powershell
powershell -c "irm https://github.com/TDSchreur/tds-factory/releases/latest/download/install.ps1 | iex"
```

The script checks that Node 20 or newer and npm are present, installs the latest Release with npm and runs `tds-factory install` for you, so you can skip part 3. It never installs Node, and it never asks for `sudo`.

If you prefer to read before you run, open the script first (the same URL in a browser) or run the two commands yourself, which work the same on macOS, Linux and Windows. This is the install:

```sh
npm install -g --allow-remote=root https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz
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

This copies the skills into `~/.claude/skills` and `~/.agents/skills` and prints an `installed` line for each skill in each folder. GitHub Copilot reads both folders, so for Copilot this one command is enough.

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

Add `--project` to install into the current project instead of your home folder. It never overwrites a skill folder it did not create. `--force` does overwrite it, so a skill of your own with the same name would be lost. An installed skill you edited is skipped as well, until you use `--force`. Add `--dry-run` to see what install would do without changing anything.

Install options:

| Option | Effect |
|---|---|
| `--agent claude\|codex\|copilot\|all` | Pick the Agent target. `all` is the default and means Claude plus Codex, because Copilot reads both directories. |
| `--project` | Install into the current directory instead of the user-global directory. |
| `--force` | Overwrite agent files and skills you edited, and skill folders that tds-factory did not install. |
| `--dry-run` | Print what install would do and change nothing. |

| Agent | Project directory | Global directory |
|---|---|---|
| claude | `.claude/skills` | `~/.claude/skills` |
| codex | `.agents/skills` | `~/.agents/skills` |
| copilot | `.github/skills` | `~/.copilot/skills` |

After you change a skill in `skills/`, run `install` again so the installed copy matches. `install` also removes folders it installed earlier that are no longer in `skills/` (it prints a `removed` line for each) and never touches folders without the tds-factory marker.

### Check that your agent sees the skills

- **GitHub Copilot in VS Code:** open the chat and type `/`. The list should include `factory`. Type `/skills` to open the skills menu. Restart VS Code if the list is empty.
- **Copilot CLI, Claude Code and Codex:** start a new session after installing, so the agent reads the skills folder again. How each agent lists skills differs; see Troubleshooting if `/factory` is missing. In Copilot in VS Code and in Claude Code, `factory` and `setup-matt-pocock-skills` only run when you start them. For `factory`, Codex ignores that setting, so it may start it on its own.

## 4. Update

Run `tds-factory update`. It looks up the latest Release, installs it with npm when yours is older, checks the download against the Release's `tds-factory.tgz.sha256`, and then runs `tds-factory install --force` so the skills and agents match the CLI. If you are already on the latest version it skips the npm step and still refreshes the skills. It never downgrades.

`--force` replaces agent files and skills you edited (for example your model choices) with the defaults, and any skill folder of the same name that `tds-factory` did not install. To keep them, run `tds-factory update --no-force`.

Running the one-line install from part 2 again also updates, and keeps your edited agent files and skills unless you set `TDS_FACTORY_FORCE=1`. The manual way still works too:

```sh
npm install -g --allow-remote=root https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz
tds-factory install
```

`tds-factory --version` shows what you now have. Maintainers publish new versions when a group of changes is ready, so updating now and then is enough. Skills are never updated by `npm install` alone; `tds-factory install` and `tds-factory update` do that.

## 5. Prepare a project

Do this once per project you want to build with the Factory.

1. Open the project in your agent. It must be a git repository with an `origin` remote on GitHub, and `gh repo view` must print the repository.
2. Run `/setup-matt-pocock-skills` in the chat. In Copilot in VS Code, type `/` and choose it; this skill only runs when you start it yourself. It looks at the repository, asks where issues live (choose GitHub) and shows you a draft before it writes anything. It uses one `GLOSSARY.md` and `docs/adr/` at the root without asking, unless the project looks like a monorepo. It writes `docs/agents/issue-tracker.md`, `docs/agents/domain.md` and an `## Agent skills` section in `CLAUDE.md` if that file exists, otherwise `AGENTS.md` (it asks which to create if neither exists).
3. Add a `## Commands` section to `AGENTS.md` (or `CLAUDE.md`, whichever the project uses) with the command that checks the project, for example `- Verify: npm test`. If it is missing, `/factory` asks you once.
4. Add `.factory/` to the project's `.gitignore`. That folder holds Run records and Run worktrees, and must not end up in commits.
5. Every Ticket the Factory creates carries the label `ready-for-agent`. If the repository's GitHub Issues do not have it yet, the agent asks before it creates it; you can also create it now with `gh label create ready-for-agent`.

6. Check the project with the Doctor. From the project folder run:

   ```sh
   tds-factory doctor
   ```

   It changes nothing and prints one line per check, for example `pass    tracker: issue tracker and domain docs are configured`. Every line should say `pass`. A line that says `missing` or `fail` names what to fix, and the command exits with 1 until nothing is left. The checks are the CLI version, the installed Skills, the tracker setup, the Git `origin` and its default branch, the review capabilities and the Verify command. Add `--agent codex` or `--agent copilot` if you do not use Claude.

Commit the new files. Now `/factory` can start; the [usage guide](usage.md) shows how.

## Troubleshooting

**The one-line install fails.** Read the error it printed: it says whether Node is missing or older than 20, whether npm cannot write its global folder (`EACCES`, see that entry below) or whether `tds-factory` is installed but not on your PATH. Behind a proxy, check that `curl` or `irm` can reach `github.com`. Running it again is safe. As a last resort use the manual commands in part 2.

**`tds-factory: command not found` (or "not recognized").** The folder where npm puts global commands is not on your PATH. Find it with `npm prefix -g`, add its `bin` folder (on Windows the folder itself) to PATH, and open a new terminal.

**`EACCES: permission denied` while installing.** npm cannot write to its global folder. Do not use `sudo`. Make npm install into your home folder instead, and put `~/.local/bin` on your PATH. Setting the prefix once also keeps `tds-factory update` and the one-line install working later. (nvm refuses to work while a prefix is set: use nvm or the prefix, not both.)

```sh
npm config set prefix ~/.local
npm install -g --allow-remote=root https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz
```

**`EALLOWREMOTE` / "Fetching packages of type remote have been disabled".** npm 12 refuses to install from a URL by default. The install command above already passes `--allow-remote=root`; if you typed it without that flag, add it. Older npm versions may print an "unknown config" warning, which is harmless.

**`404 Not Found` on the install URL.** The Factory repository is not public yet, or no Release exists. Ask the maintainer.

**`EBADENGINE` warnings or syntax errors on start.** Your Node is too old. Check `node --version` and upgrade.

**`skip ...: exists and was not installed by tds-factory`.** A skill with the same name is already in that folder, from another tool. Rename or remove it, or run `tds-factory install --force` to replace it.

**`/factory` does not appear in the chat.** Run `tds-factory install` again, then start a new chat session or restart the editor. In Copilot, `/skills` shows what it loaded.

**`/factory` stops at Preflight.** Run `tds-factory doctor` in the project (part 5, step 6): it lists what is missing or unusable (Skills, tracker setup, `origin`, review agent, Verify command). For the project setup, do part 5.

**`tds-factory run start` fails.** The error says what is missing: the folder is not a git repository (run `git init`), the repository has no commit yet (make a first commit), or the `origin` default branch cannot be determined (check `git remote -v` and that you can reach the remote).
