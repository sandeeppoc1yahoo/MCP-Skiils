// src/checks.js — interprets the declarative `checks:` block from a SKILL.md
// against the raw outputs collected from MCP tool calls.
//
// This is the "Performance" stage from the Claude article: the skill defines
// what "done" looks like; the runner just evaluates it.
//
// Each evaluator receives a context object:
//   ctx.meta      — extracted page facts (title, link count, errors, ...)
//   ctx.outputs   — { stepId: { tool, text, ok } } raw MCP tool outputs
// and returns { name, passed, detail }.

function countMatches(text, re) {
  return (text.match(re) || []).length;
}

const evaluators = {
  title_present(ctx, c) {
    const ok = !!ctx.meta.title;
    return { ok, detail: ok ? `title: "${ctx.meta.title}"` : "no page title found" };
  },

  console_errors(ctx, c) {
    const max = c.max ?? 0;
    const n = ctx.meta.consoleErrors;
    return {
      ok: n <= max,
      detail: `${n} console error(s), allowed ${max}`,
    };
  },

  failed_requests(ctx, c) {
    const max = c.max ?? 0;
    const n = ctx.meta.failedRequests;
    return {
      ok: n <= max,
      detail: `${n} failed network request(s), allowed ${max}`,
    };
  },

  min_links(ctx, c) {
    const n = ctx.meta.linkCount;
    return { ok: n >= c.value, detail: `${n} links on page, required >= ${c.value}` };
  },

  navigated(ctx, c) {
    const { startUrl, finalUrl } = ctx.meta;
    const ok = !!finalUrl && finalUrl !== startUrl;
    return {
      ok,
      detail: ok ? `navigated: ${startUrl} → ${finalUrl}` : `still on ${startUrl}`,
    };
  },
};

function runChecks(checks, ctx) {
  return checks.map((c) => {
    const fn = evaluators[c.type];
    if (!fn) {
      return { name: c.name || c.type, passed: false, detail: `unknown check type "${c.type}"` };
    }
    let r;
    try {
      r = fn(ctx, c);
    } catch (e) {
      r = { ok: false, detail: `check crashed: ${e.message}` };
    }
    return { name: c.name || c.type, passed: r.ok, detail: r.detail };
  });
}

module.exports = { runChecks };
