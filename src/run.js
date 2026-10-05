// src/run.js — the runner (a stand-in for Claude's orchestration loop).
//
//   1. Pick a skill        → skills/<name>/SKILL.md  (workflow + checks)
//   2. Connect to MCP      → Playwright MCP server    (tools)
//   3. Execute the skill's workflow, step by step, calling MCP tools
//   4. Evaluate the skill's checks against the collected outputs
//   5. Write a markdown report to reports/<runId>/report.md
//
// Usage:
//   node src/run.js                                (default: website-test on wikipedia.org)
//   node src/run.js --skill link-check --url https://example.com
//   node src/run.js --list                         (show installed skills)
//   node src/run.js --headed                       (watch the browser)
const fs = require("fs");
const path = require("path");
const { connect, ROOT } = require("./mcp");
const { listSkills, loadSkill } = require("./skills");
const { runChecks } = require("./checks");

const DEFAULTS = { skill: "website-test", url: "https://www.wikipedia.org" };

function parseArgs(argv) {
  const opts = { ...DEFAULTS, headed: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill") opts.skill = argv[++i];
    else if (a === "--url") opts.url = argv[++i];
    else if (a === "--headed") opts.headed = true;
    else if (a === "--list") opts.list = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function substitute(value, vars) {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
      if (key in vars) return String(vars[key]);
      return m; // leave unresolved placeholders visible
    });
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, vars);
    return out;
  }
  return value;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Timed out after ${ms / 1000}s: ${label}`)), ms)),
  ]);
}

/** Pull the first aria ref of a real link out of a Playwright snapshot. */
function firstLinkRef(snapshotText) {
  for (const line of snapshotText.split("\n")) {
    if (/^\s*-\s+link\s/.test(line)) {
      const m = line.match(/\[ref=([^\]]+)\]/);
      if (m) return m[1];
    }
  }
  return null;
}

/** Extract page facts from raw MCP tool outputs (defensive, multi-pattern). */
function extractMeta(outputs, startUrl) {
  const all = Object.values(outputs).map((o) => o.text).join("\n");
  const navText = Object.values(outputs)
    .filter((o) => o.tool === "browser_navigate")
    .map((o) => o.text)
    .join("\n");

  // Title: navigate output is "- Page Title: Wikipedia" (last match wins so a
  // post-click page state overrides the original navigation).
  const titles = [...all.matchAll(/^\s*-\s*Page Title:\s*(.+)$/gmi)].map((m) => m[1].trim());
  let title = titles.length ? titles[titles.length - 1] : "";
  if (!title) title = (all.match(/^\s*Title:\s*(.+)$/mi) || [])[1]?.trim() || "";
  if (!title) title = (all.match(/<title>([^<]+)<\/title>/i) || [])[1] || "";

  // Final URL: "- Page URL: https://..." (last occurrence = current page)
  const urlMatches = [...all.matchAll(/^\s*-\s*(?:Page\s+)?URL:\s*(\S+)/gmi)].map((m) => m[1]);
  let finalUrl = urlMatches.length ? urlMatches[urlMatches.length - 1] : "";
  if (!finalUrl) {
    const navUrls = [...navText.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0]);
    finalUrl = navUrls.length ? navUrls[navUrls.length - 1] : "";
  }

  // Structure counts from the accessibility snapshot
  const snapText = Object.values(outputs)
    .filter((o) => o.tool === "browser_snapshot")
    .map((o) => o.text)
    .join("\n");
  const count = (re) => (snapText.match(re) || []).length;
  const linkCount = count(/^\s*-\s+link\s/gm);
  const headingCount = count(/^\s*-\s+heading\s/gm);
  const buttonCount = count(/^\s*-\s+button\s/gm);
  const imageCount = count(/^\s*-\s+image\s/gm);

  // Console errors
  const consoleText = Object.values(outputs)
    .filter((o) => o.tool === "browser_console_messages")
    .map((o) => o.text)
    .join("\n");
  let consoleErrors = 0;
  const errSummary = consoleText.match(/Errors:\s*(\d+)/);
  if (errSummary) {
    consoleErrors = parseInt(errSummary[1], 10); // "Total messages: N (Errors: E, Warnings: W)"
  } else if (consoleText && !/no console messages/i.test(consoleText)) {
    consoleErrors = (consoleText.match(/"type"\s*:\s*"error"/g) || []).length;
    if (consoleErrors === 0) consoleErrors = 1; // non-empty, unparseable output → treat as an error
  }

  // Failed network requests
  const netText = Object.values(outputs)
    .filter((o) => o.tool === "browser_network_requests")
    .map((o) => o.text)
    .join("\n");
  let failedRequests = 0;
  const failSummary = netText.match(/Failed(?: requests)?:\s*(\d+)/i);
  if (failSummary) {
    failedRequests = parseInt(failSummary[1], 10);
  } else if (netText && !/no (?:failed )?network requests|nothing to show/i.test(netText)) {
    failedRequests = (netText.match(/\b(?:status["':\s]*|[\[\(])([45]\d{2})\b/gi) || []).length;
    if (failedRequests === 0 && /\bfailed\b/i.test(netText) && !/\b0 failed\b/i.test(netText)) {
      failedRequests = 1;
    }
  }

  return { title, startUrl, finalUrl, linkCount, headingCount, buttonCount, imageCount, consoleErrors, failedRequests };
}

function writeReport({ skill, opts, runId, steps, checks, meta }) {
  const outDir = path.join(ROOT, "reports", runId);
  const allPassed = checks.every((c) => c.passed) && steps.every((s) => s.ok);
  const lines = [];
  lines.push(`# ${skill.name} report — ${meta.title || "(untitled page)"}`);
  lines.push("");
  lines.push(`- **Skill:** ${skill.name} — ${skill.description}`);
  lines.push(`- **MCP server:** playwright (Playwright MCP, system Edge)`);
  lines.push(`- **Target URL:** ${opts.url}`);
  lines.push(`- **Final URL:** ${meta.finalUrl || "(unknown)"}`);
  lines.push(`- **Run ID:** ${runId}`);
  lines.push(`- **Result:** ${allPassed ? "✅ PASS" : "❌ FAIL"}`);
  lines.push("");
  lines.push("## Checks (defined by the skill)");
  lines.push("");
  lines.push("| Status | Check | Detail |");
  lines.push("|---|---|---|");
  for (const c of checks) {
    lines.push(`| ${c.passed ? "✅ PASS" : "❌ FAIL"} | ${c.name} | ${c.detail} |`);
  }
  lines.push("");
  lines.push("## Workflow steps executed (skill plan → MCP tool calls)");
  lines.push("");
  lines.push("| # | Step | MCP tool | Status |");
  lines.push("|---|---|---|---|");
  steps.forEach((s, i) => {
    lines.push(`| ${i + 1} | ${s.description || s.id} | \`${s.tool}\` | ${s.ok ? "✅" : "❌ " + (s.error || "")} |`);
  });
  lines.push("");
  lines.push("## Page metadata (extracted from MCP outputs)");
  lines.push("");
  lines.push(`- Title: ${meta.title || "—"}`);
  lines.push(`- Links: ${meta.linkCount} · Headings: ${meta.headingCount} · Buttons: ${meta.buttonCount} · Images: ${meta.imageCount}`);
  lines.push(`- Console errors: ${meta.consoleErrors} · Failed requests: ${meta.failedRequests}`);
  lines.push("");
  lines.push("## Artifacts");
  lines.push("");
  const shots = steps.flatMap((s) => s.artifacts || []);
  if (shots.length) for (const a of shots) lines.push(`- ${a}`);
  else lines.push("- (none)");
  lines.push("");
  lines.push("## Raw tool outputs");
  lines.push("");
  for (const s of steps) {
    lines.push(`<details><summary>${s.id} · ${s.tool}</summary>`);
    lines.push("");
    lines.push("```");
    lines.push((s.text || "(no text)").slice(0, 3000));
    lines.push("```");
    lines.push("</details>");
    lines.push("");
  }
  fs.writeFileSync(path.join(outDir, "report.md"), lines.join("\n"));
  return path.join(outDir, "report.md");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: node src/run.js [--skill <name>] [--url <url>] [--headed] [--list]");
    return;
  }
  if (opts.list) {
    console.log("Installed skills:\n");
    for (const s of listSkills()) console.log(`  ${s.name.padEnd(16)} ${s.description}`);
    return;
  }

  const skill = loadSkill(opts.skill);
  const runId = `${skill.name}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  fs.mkdirSync(path.join(ROOT, "reports", runId), { recursive: true });

  console.log(`\n=== Skill: ${skill.name} ===`);
  console.log(`MCP server: playwright  |  Target: ${opts.url}\n`);

  const mcp = await connect({ headed: opts.headed });
  const steps = [];
  const outputs = {};
  const vars = { url: opts.url, runId, skill: skill.name };

  try {
    const toolNames = new Set((await mcp.listTools()).map((t) => t.name));

    for (const [i, step] of skill.workflow.entries()) {
      const id = step.id || `step${i + 1}`;
      if (!toolNames.has(step.tool)) {
        steps.push({ id, tool: step.tool, description: step.description, ok: false, error: "tool not exposed by server", text: "" });
        break;
      }
      const args = substitute(step.args || {}, vars);
      process.stdout.write(`  [${i + 1}/${skill.workflow.length}] ${step.description || step.tool} ... `);
      try {
        const r = await withTimeout(mcp.callTool(step.tool, args), 120000, step.tool);
        const ok = !r.isError;
        steps.push({ id, tool: step.tool, description: step.description, ok, text: r.text, error: ok ? "" : (r.text || "tool error").slice(0, 120) });
        outputs[id] = { tool: step.tool, text: r.text };
        if (r.images.length && !args.filename) {
          const p = path.join(ROOT, "reports", runId, `${id}.png`);
          fs.writeFileSync(p, Buffer.from(r.images[0].data, "base64"));
          steps[steps.length - 1].artifacts = [path.relative(ROOT, p)];
        }
        if (step.tool === "browser_take_screenshot" && args.filename) {
          steps[steps.length - 1].artifacts = [args.filename];
        }
        // Refresh dynamic vars (e.g. first_link_ref for a later click step)
        const snap = Object.values(outputs).filter((o) => o.tool === "browser_snapshot").pop();
        const ref = snap ? firstLinkRef(snap.text) : null;
        if (ref) vars.first_link_ref = ref;
        console.log(ok ? "ok" : "ERROR");
      } catch (e) {
        steps.push({ id, tool: step.tool, description: step.description, ok: false, error: e.message, text: "" });
        outputs[id] = { tool: step.tool, text: "" };
        console.log(`FAILED (${e.message})`);
      }
    }

    const meta = extractMeta(outputs, opts.url);
    const ctx = { meta, outputs };
    const checks = runChecks(skill.checks, ctx);

    const reportPath = writeReport({ skill, opts, runId, steps, checks, meta });

    console.log("\n--- Checks ---");
    for (const c of checks) console.log(`  ${c.passed ? "✅" : "❌"} ${c.name}  (${c.detail})`);
    const allPassed = checks.every((c) => c.passed) && steps.every((s) => s.ok);
    console.log(`\nResult: ${allPassed ? "PASS ✅" : "FAIL ❌"}`);
    console.log(`Report: ${path.relative(process.cwd(), reportPath)}`);
    process.exitCode = allPassed ? 0 : 1;
  } finally {
    await mcp.close();
  }
}

main().catch((e) => {
  console.error(`\nFatal: ${e.message}`);
  process.exit(2);
});
