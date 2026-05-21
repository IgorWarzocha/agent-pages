# Agent Pages installation guide for agents

This file is meant to be read by an agent helping a user install Agent Pages.

Do not assume paths. Ask before choosing where to clone or where to install the skill.

If your agent environment has an ask-questions/planning tool, use it before making changes. Batch the choices the user needs to make instead of asking one question at a time.

## Goal

Install Agent Pages locally, install its agent skill, and optionally make it easy to start on the user's machine.

## Steps

### 1. Ask where to clone the repo

Ask the user where they want Agent Pages installed.

If they do not care, suggest a normal workspace location such as:

- `~/Work/agent-pages`
- `~/Projects/agent-pages`
- `~/agent-pages`

Then clone:

```bash
git clone https://github.com/IgorWarzocha/agent-pages.git <chosen-directory>
cd <chosen-directory>
```

If the directory already exists, do not overwrite it. Ask whether to use the existing clone or choose another location.

### 2. Install dependencies

Agent Pages uses Git and Bun.

Check that Git exists:

```bash
git --version
```

If Git is missing, tell the user to install it with their OS package manager before continuing.

Check that Bun exists:

```bash
bun --version
```

If Bun is missing, tell the user to install it from:

```text
https://bun.sh/
```

If the user does not want to install Bun, ask whether they want you to adapt the project to another package manager/bundler. Do not do this silently. Rewiring the project away from Bun requires code and script changes, so ask for their preferred target first, such as npm, pnpm, yarn, or another setup.

Then install dependencies:

```bash
bun install
```

### 3. Install and tailor the skill

The bundled skill is here:

```text
.agents/agent-pages/SKILL.md
```

Ask whether the user wants the skill installed globally or only for one repo.

- Global skill install is preferred. The user installs it once and can use `agent-pages` from any project.
- Repo-level install is more cumbersome. The user has to copy/install it separately for each repo where they want to use Agent Pages.

Find the user's likely skill directories from their environment. Check common locations before asking:

- Existing global skill directories for the user's agent
- Repo-level instruction directories such as `.agents` in the relevant workspace
- Other agents: their documented skills/instructions directory

If there are already global skills present, prefer the matching global location. If more than one plausible skill system exists, ask the user which agent they want to install Agent Pages for.

Copy the skill into the chosen location. Preserve the skill name `agent-pages`.

Example global install layout:

```bash
mkdir -p <global-skills-dir>/agent-pages
cp .agents/agent-pages/SKILL.md <global-skills-dir>/agent-pages/SKILL.md
```

Example repo-level install layout:

```bash
mkdir -p <repo>/.agents/agent-pages
cp .agents/agent-pages/SKILL.md <repo>/.agents/agent-pages/SKILL.md
```

After the user chooses how they want to start Agent Pages in step 5, tidy the installed skill so its troubleshooting section matches their choice. For example:

- if they chose manual startup, say to run `bun run dev` from their Agent Pages clone
- if they chose a shortcut, name the shortcut
- if they chose a service, name the service and include the basic status/log command for their OS

Do not leave irrelevant service/shortcut instructions in the installed skill.

### 4. Start Agent Pages

Start it from the clone:

```bash
bun run dev
```

Open:

```text
http://127.0.0.1:47983
```

Verify the discovery endpoint works:

```bash
curl -s http://127.0.0.1:47983/api/agent-pages
```

It should return JSON with `url`, `rootDir`, `pagesDir`, and `port`.

### 5. Ask how they want to launch it later

Ask the user whether they want one of these:

1. no extra setup; they will run `bun run dev` manually
2. a desktop/shell shortcut that runs `bun run dev` from the clone
3. a system service that starts Agent Pages when the computer starts

Do not create a service or shortcut without asking.

If they choose a service, use the native service manager for their OS:

- Linux: user-level systemd service when available
- macOS: LaunchAgent
- Windows: Task Scheduler or a startup shortcut

Keep the service simple: run `bun run dev` in the Agent Pages clone. Do not change the app port unless the user explicitly asks.

### 6. Check out a personal branch

As the final setup step, create and switch to a personal branch for the user's local artifacts and machine-specific changes:

```bash
git checkout -b personal
```

If `personal` already exists, switch to it instead:

```bash
git checkout personal
```

The main branch should stay clean and easy to update. Personal artifacts, local experiments, and machine-specific tweaks belong on the personal branch.

## Notes for agents

- Agent Pages runs on `127.0.0.1:47983` by default.
- New artifacts go in the `pagesDir` returned by `/api/agent-pages`.
- Do not guess the user's clone path.
- Do not edit Agent Pages source during installation unless the user asks.
- If sessions or artifacts do not show up, run `bun run index` from the clone.
