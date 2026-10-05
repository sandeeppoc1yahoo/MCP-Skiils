---
name: link-check
description: Verify that a reputable website's navigation actually works — opens the home page, clicks a real link using its accessibility reference, and confirms the browser reached a different page. Use when the user wants to test site navigation or interactivity rather than just availability.
---

# Link Navigation Check

**MCP connection used:** `playwright` (the same server as `website-test` —
one MCP server, many skills, exactly as the Claude article describes.)

## When to use

Availability isn't enough: the user wants proof that the site is *interactive* —
that a real click on a real link navigates somewhere.

## Workflow

Steps read the accessibility snapshot to discover a live `ref=...` handle, then
hand that ref to the click tool. The runner fills `{{first_link_ref}}` from the
most recent snapshot, so the workflow stays declarative.

```yaml
workflow:
  - id: nav
    description: Open the target page
    tool: browser_navigate
    args:
      url: "{{url}}"
  - id: snapshot
    description: Snapshot the page to discover a link reference
    tool: browser_snapshot
  - id: click
    description: Click the first real link on the page
    tool: browser_click
    args:
      element: "first link on the page"
      target: "{{first_link_ref}}"
  - id: after
    description: Snapshot the destination page
    tool: browser_snapshot
  - id: screenshot
    description: Save visual evidence of the destination page
    tool: browser_take_screenshot
    args:
      filename: "reports/{{runId}}/after-click.png"
      scale: css

checks:
  - name: Destination page has a title
    type: title_present
  - name: Click actually navigated away from the home page
    type: navigated
```

## How to read the results

- `navigated` fails if the browser is still on the original URL — that means
  the click was swallowed (JS handler prevented default, or the ref was stale).
- The two snapshots (before/after) are in the report's raw outputs, so you can
  diff the page structure around the click.
