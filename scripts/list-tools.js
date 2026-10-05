// Probe: connects to the Playwright MCP server over stdio and prints tool schemas.
const { spawn } = require("child_process");

const child = spawn(
  process.execPath,
  [require("path").join(__dirname, "..", "node_modules", "@playwright", "mcp", "cli.js"), "--browser", "msedge", "--headless"],
  { stdio: ["pipe", "pipe", "inherit"], cwd: require("path").join(__dirname, "..") }
);

const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

const WANTED = [
  "browser_navigate",
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_console_messages",
  "browser_network_requests",
  "browser_wait_for",
  "browser_click",
  "browser_evaluate",
];

let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id === 2) {
      for (const t of m.result.tools) {
        if (WANTED.includes(t.name)) {
          console.log("##", t.name);
          console.log(JSON.stringify(t.inputSchema, null, 1));
        }
      }
      child.kill();
      process.exit(0);
    }
  }
});

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1.0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

setTimeout(() => { console.error("timeout"); child.kill(); process.exit(1); }, 30000);
