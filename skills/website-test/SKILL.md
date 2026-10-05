---
name: website-test
description: Smoke-test any reputable public website through the Playwright MCP server — verifies the page loads, has real content, and produced no console or network errors. Use when the user wants to test, verify, or check that a website is up and healthy.
---

# Website Smoke Test

**MCP connection used:** `playwright` (Playwright MCP server)
**Role split (per the Claude skills+MCP article):** the MCP server only supplies
browser *tools*; this skill supplies the *workflow* — which tools to call, in
what order, and what "done" looks like.

## When to use

The user asks to test / verify / smoke-test a public website: "is it up,
does it render, are there broken requests or JS errors?"

## Workflow

```yaml
workflow:
  - id: nav
    description: Open the target page in the browser
    tool: browser_navigate
    args:
      url: "{{url}}"
  - id: console
    description: Read browser console errors since navigation
    tool: browser_console_messages
    args:
      level: error
      all: false
  - id: network
    description: List failed network requests
    tool: browser_network_requests
    args:
      static: false
  - id: structure
    description: Capture accessibility snapshot (page structure as aria tree)
    tool: browser_snapshot
  - id: screenshot
    description: Save visual evidence of the rendered page
    tool: browser_take_screenshot
    args:
      filename: "reports/{{runId}}/home.png"
      scale: css
      fullPage: true

checks:
  - name: Page loaded with a title
    type: title_present
  - name: No browser console errors
    type: console_errors
    max: 0
  - name: No failed network requests
    type: failed_requests
    max: 0
  - name: Page has at least 5 links (real content, not an error page)
    type: min_links
    value: 5
```

## How to read the results

- The **checks** block is the skill's definition of "done" — the runner only
  evaluates it, it never invents pass criteria.
- `min_links` guards against soft-404s: an error page usually has no links.
- Raw tool outputs are appended to the report so a human can audit every MCP
  call the skill made.
