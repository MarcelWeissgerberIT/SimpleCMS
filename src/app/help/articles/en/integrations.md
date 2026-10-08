---
id: integrations
title: Integrations
section: ai
order: 14
keywords: integrations, integration profile, profile, unlock, unlocks, MCP server, match, tools, recipe, mirror, import, export, JSON, schema, one.integration, key, only by hand, upsert, tool list, agent state, inbox notes, Integrationen, Profil, freischalten, Rezept
related: custom-agents, mcp-servers, properties, members-roles
summary: Profiles that unlock agent features — keys, “Only by hand”, upsert_rows, tool lists, the agent state, inbox notes — and bring recipes while one of your MCP servers matches.
---
Some agent features only make sense together with another tool: mirroring its items into a database by a key, keeping your own fields out of reach, limiting an agent to that tool's reading tools. One does not build them in for any particular tool. An **integration profile** says which MCP server they are for and switches them on while that server is there. You set profiles up under **Workspace → Integrations**.

## When a profile is active
A profile is **active on this device** when one of your **switched-on** MCP servers (**Settings → Claude AI → MCP servers**) meets every condition of its `match`:
- `tools` — every listed tool is in the server's tool list from its last **connection test** (a server that was never tested has no list yet).
- `name` — a pattern on the server's name: `*` stands for any characters, `?` for one, upper and lower case are the same (`tracker*`).
- `host` — a pattern on the host of the server's address (`*.example.com`).

At least one condition is needed. The list shows an LED per profile and why: **Active · matches TRACKER**, **Inactive · no enabled MCP server offers list_items**, **Inactive · no match conditions** … Below it, **Unlocked on this device** lists what is switched on here right now.

## What a profile unlocks
- `keys` — the **Key** switch in the property menu.
- `onlyByHand` — the **Only by hand** switch in the property menu.
- `upsert` — the tool `upsert_rows` for agents and the [AI terminal](help:agent).
- `toolAllowList` — the tool list per MCP server in the agent editor.
- `agentState` — `agent_state_get` / `agent_state_set` between runs.
- `notify` — `notify_me`: an agent's notes in your inbox.

Without an active profile these switches, tools and sections are not offered. What is already set **stays in force**: a property that is the key stays unique, “Only by hand” fields stay closed to every agent (they show as a mark in the property menu), and an agent that already has a tool list keeps it.

## Recipes as configuration
A profile can bring **recipes**. While it is active, **Agents → New agent** lists them, named by the profile. A recipe of kind `mirror` creates a database for another tool's items, its views, a report page and a scheduled agent — everything in it is data: the database's name, its properties (`role`, `name`, `type`, `options`, `key`, `onlyByHand`, `color`, `description`), its views (`type`, `properties`, `groupBy`, `date`, `filter`, `sort`, `colorRules`, `hiddenGroups`, `hideEmpty`) and the agent (`name`, `schedule`, `write`, `budget`, `model`, `effort`, `tools`, `instructions`). Whatever a recipe leaves out takes the built-in mirror's values, so `{ "kind": "mirror" }` alone is the recipe described in [Custom agents](help:custom-agents).

Texts can be one string or one per language: `{ "en": "Ready", "de": "Bereit" }`. Views name properties by name (either language) or by `role`, filter values name options. In the agent's name, instructions and report title, `{db}`, `{server}` and `{report}` are filled in; parts in **[SQUARE BRACKETS]** are left for the person to replace before the agent can be switched on.

## The schema
A profile is one JSON object, schema `one.integration/1`:

```json
{
  "schema": "one.integration/1",
  "id": "item-tracker",
  "name": "Item tracker",
  "description": "Mirrors the open items of our tracker.",
  "match": { "tools": ["list_items", "get_item"], "name": "tracker*" },
  "unlocks": ["keys", "onlyByHand", "upsert", "toolAllowList", "agentState", "notify"],
  "recipes": [
    {
      "kind": "mirror",
      "name": { "en": "Mirror tracker items", "de": "Tracker-Einträge spiegeln" },
      "database": {
        "name": "Items",
        "properties": [
          { "role": "name", "name": "Name", "type": "title" },
          { "role": "key", "name": "Item", "type": "text", "key": true },
          { "name": "State", "type": "select", "options": [{ "name": "Open", "color": "yellow" }, { "name": "Ready", "color": "green" }] },
          { "name": "My note", "type": "text", "onlyByHand": true }
        ],
        "views": [
          { "name": "By state", "type": "board", "groupBy": "State", "hideEmpty": true },
          { "name": "Ready", "type": "table", "filter": { "property": "State", "op": "is", "value": "Ready" } }
        ]
      },
      "agent": { "schedule": { "every": "weekday", "at": "07:30" }, "write": "stage", "budget": 1, "tools": ["list_items", "get_item"] }
    }
  ]
}
```

`id`: lower-case letters, digits, `-` and `_`. `unlocks`: any of the six features. Unknown keys are refused, so a typo shows at once.

## New, import, export, edit
- **New integration → From the template** — the built-in mirror written out in full, with an empty `match` to fill in. **For one of your MCP servers** fills `match` with that server's tested reading tools and its name.
- **Import** — paste a profile or **Load a .json file**. Nothing is saved until you add it; a profile with an id that exists replaces that one.
- **Export** — downloads `<id>.integration.json`.
- **Edit** — the profile's JSON with colours, line numbers and live checks: a syntax error names its line and column, a schema problem its path (`$.recipes[0].database.views[1].groupBy`) and line, and the status line says **Valid · active here · unlocks … · 1 recipe**. Click a problem to jump there; **Format** tidies the indentation.
- **Delete** — with **Undo** in the message.

## Team workspaces
Profiles belong to the workspace and sync to everyone. **Owners and admins** add, change and delete them — the server puts anyone else's change back; members view and export them. Whether a profile is active still depends on each person's own MCP servers. [Server agents](help:custom-agents) use the server's MCP servers instead: there a profile matches by `name` or `host` (the server has no tool lists) and unlocks `upsert_rows` and the agent state for the team's server agents. Full backups carry the profiles; page backups never do.
