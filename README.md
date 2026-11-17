# plugin-inventory

A Claude Code skill that writes one Markdown file listing every plugin installed in a scope, grouped by function, with a "when to use" note for each plugin.

## Use it

In Claude Code, type:

```text
/plugin-inventory
```

Claude asks for the scope (`user`, `project`, or `local`) if you do not give one. It then writes the report:

| Scope | Report file |
| --- | --- |
| `user` | `~/.claude/plugins-report.md` |
| `project`, `local` | `<project>/.claude/plugins-report.md` |

An existing report file is replaced. For `project` and `local`, the project is the current directory unless you give another path.

Each plugin entry has:

- name, status (Active or Inactive), version, and marketplace
- the original description
- "When to use": one or two sentences
- the plugin's skills, commands, and agents, each with its description

The report starts with the date, the scope, and the number of active and inactive plugins.

## Why this skill

- **It covers inactive plugins.** A plugin installed in the scope but not enabled in its settings gets a full entry, marked Inactive.
- **It reads files only.** It does not install, enable, or disable plugins. It does not describe hooks or MCP servers.
- **It uses no invented facts.** Every field comes from the files on disk. A missing description is written as "no description".
- **It has no dependencies.** The collector is one Node.js script.

## Install

1. Copy this folder to `~/.claude/skills/plugin-inventory`. The skill calls the script at that exact path.
2. Make sure `node` is on your `PATH`. The collector was tested on Node.js 26.9.

You can check the collector alone:

```bash
node ~/.claude/skills/plugin-inventory/scripts/collect-plugins.mjs --scope user
```

It prints JSON with the fields `active`, `inactive`, and `warnings`. A missing or invalid file adds a message to `warnings`. The script does not stop. An invalid `--scope` value stops it with exit code 1.

## Manual invocation only

The skill sets `disable-model-invocation: true`. Claude does not start it by itself. You must type `/plugin-inventory`.

## What it reads

- `settings.json` for the scope (`enabledPlugins`)
- `~/.claude/plugins/installed_plugins.json`
- `~/.claude/plugins/known_marketplaces.json`
- each plugin's `.claude-plugin/plugin.json`, and its skill, command, and agent files

## Status

Early version, for personal use. The report is in English.
