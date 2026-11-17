---
name: plugin-inventory
description: Generates a Markdown inventory of every Claude Code plugin installed in one scope (user, project, or local), active or not, grouped by function, with a "when to use" note for each plugin plus its skills, commands, and agents. Use this skill whenever the user asks for an inventory, report, or document of their Claude Code plugins, asks which plugins they have, or asks when to use each plugin, even if they do not say "inventory".
disable-model-invocation: true
---

# Plugin inventory

Write a Markdown document that documents every plugin installed in one Claude Code scope, active or not, and explains when to use each one.

Do not install, enable, or disable plugins. Do not describe hooks or MCP servers.

## Steps

1. **Get the scope.** The scope is `user`, `project`, or `local`. If the user did not state the scope, ask. For `project` and `local`, the project path is the current directory unless the user gives another path.
2. **Run the script.** The script reads only files and has no dependencies:
   ```bash
   node ~/.claude/skills/plugin-inventory/scripts/collect-plugins.mjs --scope <scope> [--project <path>]
   ```
   Read the JSON from standard output. Fields: `active`, `inactive`, `warnings`. Each plugin has `name`, `version`, `marketplace`, `description`, `category`, `skills`, `commands`, `agents`.
3. **Treat `active` and `inactive` plugins the same way.** Each plugin from both lists gets a full entry. The `inactive` plugins are installed in the scope but not enabled in its settings.
4. **Group all plugins into sections by function**, for example: Development, Documents, Design, Productivity, Data, Security. Use the plugin `category` and description to decide. Do not mention the marketplace category, or how a section was chosen, in the document. Do not make a separate section for inactive plugins.
5. **Write one entry per plugin** with these items:
   - name
   - status: Active or Inactive
   - version
   - marketplace
   - description (keep the original text)
   - "When to use": 1 or 2 sentences, based only on the descriptions in the JSON. For an inactive plugin, say what it is for; do not say it is running.
   - list of skills, commands, and agents, each with its original description
6. **Write the document in English.** Put the date, the scope, and the counts of active and inactive plugins at the top. Keep the original descriptions as they are.
7. **Save the file and replace any existing file:**
   - `user`: `~/.claude/plugins-report.md`
   - `project` and `local`: `<project>/.claude/plugins-report.md`
8. **Show the script warnings** to the user, one per line. If there are none, say so.

## Rules

- Use only facts from the JSON. If a description is missing, write "no description" instead of inventing one.
- Do not mix plugins from different scopes in one document.
- The script does not stop on a missing or invalid file. It adds a message to `warnings`. A plugin with a warning can have empty lists. Do not fill the gaps from memory.
