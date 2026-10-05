// src/skills.js — loads Agent Skills from the skills/ directory.
//
// A skill is a SKILL.md file with:
//   1. YAML frontmatter  → name + description (how the agent discovers it)
//   2. Prose sections    → guidance for a human/LLM reading the skill
//   3. A ```yaml block    → machine-readable workflow the runner executes:
//        workflow: ordered steps, each one an MCP tool call
//        checks:   declarative pass/fail criteria ("what done looks like")
//
// Per the Claude article: the skill carries the WORKFLOW, the MCP server
// carries the TOOLS. Neither knows about the other's internals.
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const SKILLS_ROOT = path.join(__dirname, "..", "skills");

function parseSkillFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");

  // 1. Frontmatter (--- ... ---)
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) throw new Error(`${filePath}: missing YAML frontmatter`);
  const meta = YAML.parse(fm[1]);

  // 2. The fenced ```yaml ... ``` block containing workflow:/checks:
  const blocks = [...raw.matchAll(/```ya?ml\r?\n([\s\S]*?)```/g)];
  const wfBlock = blocks.map((b) => b[1]).find((b) => /^\s*workflow:/m.test(b));
  if (!wfBlock) throw new Error(`${filePath}: no "workflow:" yaml block found`);
  const wf = YAML.parse(wfBlock);

  if (!Array.isArray(wf.workflow) || wf.workflow.length === 0) {
    throw new Error(`${filePath}: workflow must be a non-empty list`);
  }
  for (const step of wf.workflow) {
    if (!step.tool) throw new Error(`${filePath}: every step needs a "tool"`);
  }

  return {
    name: meta.name,
    description: meta.description || "",
    path: filePath,
    workflow: wf.workflow,
    checks: wf.checks || [],
    raw,
  };
}

/** List all installed skills (name + description). */
function listSkills() {
  if (!fs.existsSync(SKILLS_ROOT)) return [];
  return fs
    .readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(SKILLS_ROOT, d.name, "SKILL.md"))
    .filter((p) => fs.existsSync(p))
    .map(parseSkillFile);
}

/** Load one skill by its frontmatter name. */
function loadSkill(name) {
  const skill = listSkills().find((s) => s.name === name);
  if (!skill) {
    const names = listSkills()
      .map((s) => s.name)
      .join(", ");
    throw new Error(`Skill "${name}" not found. Installed skills: ${names}`);
  }
  return skill;
}

module.exports = { listSkills, loadSkill, SKILLS_ROOT };
