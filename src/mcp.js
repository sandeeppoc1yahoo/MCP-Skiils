// src/mcp.js — thin wrapper around the official Playwright MCP server.
//
// This file is "the connection" from the Claude article: it gives the agent
// ACCESS to a browser (tools), but contains no workflow knowledge itself.
// All workflow logic lives in skills/*/SKILL.md.
const path = require("path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const ROOT = path.join(__dirname, "..");
const PLAYWRIGHT_MCP_CLI = path.join(ROOT, "node_modules", "@playwright", "mcp", "cli.js");

/**
 * Spawn the Playwright MCP server as a subprocess and connect over stdio.
 * Uses the system Microsoft Edge (no ~170 MB browser download needed).
 */
async function connect({ headed = false } = {}) {
  const args = [PLAYWRIGHT_MCP_CLI, "--browser", "msedge"];
  if (!headed) args.push("--headless");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    cwd: ROOT,
    env: process.env,
  });

  const client = new Client(
    { name: "mcp-skills-runner", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);

  return {
    /** List the tools the MCP server exposes (the "aisles" of the store). */
    async listTools() {
      const { tools } = await client.listTools();
      return tools;
    },

    /**
     * Call one MCP tool. Returns a normalized result:
     *   { text, images, isError }  — text joined, images as raw base64 blocks.
     */
    async callTool(name, args = {}) {
      const res = await client.callTool({ name, arguments: args });
      const content = res.content || [];
      const text = content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const images = content.filter((c) => c.type === "image");
      return { text, images, isError: !!res.isError };
    },

    async close() {
      try {
        await client.close();
      } catch {
        /* server may already be gone */
      }
    },
  };
}

module.exports = { connect, ROOT };
