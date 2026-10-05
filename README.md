# MCP + Skills: Playwright Website Testing

A minimal, **running** demonstration of the pattern described in Claude's article
[*Extending Claude's capabilities with skills and MCP servers*](https://claude.com/blog/extending-claude-capabilities-with-skills-mcp-servers):

> **MCP provides connectivity (tools). Skills provide expertise (workflow).**

```
                    ┌──────────────────────────────────────────────┐
   "Test this       │  src/run.js  — the orchestration loop        │
   website for me"  │  (stand-in for Claude's agent loop)          │
        │           └──────────────┬───────────────────────────────┘
        ▼                          │ 1. load skill (workflow + checks)
┌───────────────┐                  │ 2. call MCP tools, step by step
│  SKILL.md     │──────────────────┤ 3. evaluate the skill's checks
│  (expertise)  │  workflow:       │ 4. write reports/<runId>/report.md
│               │  - browser_navigate
│  checks:      │  - browser_snapshot
│  what "done"  │  - browser_take_screenshot ...
│  looks like   │
└───────────────┘
        │                          ┌───────────────────────────────┐
        │  (no code, just          │  @playwright/mcp server       │
        │   instructions)          │  25 browser tools ("aisles")  │
        └──────────────────────────│  browser_navigate, browser_…  │
                                   └──────────────┬────────────────┘
                                                  ▼
                                          Microsoft Edge (system)
```

## Quick start

```bash
npm install                 # already done if node_modules exists
npm run list-skills         # show installed skills
npm test                    # website-test on https://www.wikipedia.org
npm run test:links          # link-check (clicks a real link) on wikipedia.org
npm run test:example        # website-test on https://example.com
npm start -- --url https://www.github.com --headed   # any site, watch the browser
```

Each run writes `reports/<runId>/report.md` plus a full-page screenshot.

## The pieces

| Path | What it is (article terminology) |
|---|---|
| `.mcp.json` | Registers the **Playwright MCP server** for MCP-aware clients (Claude Code etc.) |
| `src/mcp.js` | **Connectivity** — spawns `@playwright/mcp` over stdio (system Edge, headless by default) |
| `skills/website-test/SKILL.md` | **Skill #1** — smoke-test workflow + pass/fail checks |
| `skills/link-check/SKILL.md` | **Skill #2** — interactive navigation test, *same MCP server* |
| `src/skills.js` | Skill loader (frontmatter + embedded workflow YAML) |
| `src/run.js` | Orchestration loop: skill → MCP tool calls → checks → report |
| `src/checks.js` | Evaluates a skill's declarative `checks:` block |
| `scripts/list-tools.js` | Prints the live tool schemas the MCP server exposes |
| `reports/` | Generated reports + screenshots, one folder per run |

## Skills vs. MCP (as implemented here)

- **MCP server** knows *how to drive a browser* — navigate, snapshot, click,
  screenshot. It knows nothing about testing, reports, or your standards.
- **Skill** knows *how to test a website* — which tools to call in which order,
  and that "done" means title present, zero console errors, ≥5 links. It cannot
  move a browser by itself.
- **Runner** is the glue an LLM normally provides: it reads the skill and
  issues the MCP calls. Swap `src/run.js`'s fixed executor for an LLM that
  reads the same SKILL.md and you have the production architecture from the
  article.

### One server, many skills

Both `website-test` and `link-check` talk to the **same** Playwright MCP
connection — add a new skill (e.g. a form-fill or visual-regression workflow)
by dropping a new `skills/<name>/SKILL.md`; no MCP code changes.

### Progressive disclosure in practice

Skill descriptions live in frontmatter and are always visible (cheap); the full
workflow only loads when the skill is chosen — the same on-demand loading the
article describes for Claude Skills.

## Using it from Claude Code / other MCP clients

`.mcp.json` registers the server in the project. An MCP-aware agent that can
also read `skills/*/SKILL.md` gets the full pattern: tools from MCP, workflow
from skills.

## Requirements

- Node.js ≥ 18
- Microsoft Edge (used via `--browser msedge`; no Chromium download needed)
- Internet access to reach the site under test
