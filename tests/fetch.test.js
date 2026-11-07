const assert = require("assert");
const http = require("http");
const Module = require("module");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { Writable } = require("stream");
const fetch = require("../fetch");

// Load actual entry points, stubbing only MagicMirror and the diagnostic main.
function loadEntry(filename) {
  const fullPath = path.join(__dirname, "..", filename);
  let source = fs.readFileSync(fullPath, "utf8");
  if (filename === "test_connection.js") {
    source = source.slice(0, source.lastIndexOf("main().catch(")) + "module.exports = { synoFetch };";
  }
  const localRequire = Module.createRequire(fullPath);
  const sandbox = {
    require: (name) => name === "node_helper" ? { create: (helper) => helper } : localRequire(name),
    module: { exports: {} }, __dirname: path.dirname(fullPath),
    console, URLSearchParams, setTimeout, clearTimeout
  };
  vm.runInNewContext(source, sandbox, { filename: fullPath });
  return sandbox.module.exports;
}

async function main() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, referer: req.headers.referer });
    if (req.url === "/image") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end("thumbnail-bytes");
    } else if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/image" });
      res.end();
    } else {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true, data: { sid: "local-session", list: [] } }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const agent = new http.Agent();
  try {
    assert.strictEqual(typeof fetch, "function");
    const response = await fetch(base + "/redirect", { agent });
    assert.strictEqual(await response.text(), "thumbnail-bytes");

    const helper = loadEntry("node_helper.js");
    helper.config = { serverUrl: "127.0.0.1", port: server.address().port, secure: false,
      account: "local-test", password: "not-a-real-password" };
    helper.loadDeviceToken = () => null;
    assert.strictEqual(await helper.login(), true);
    assert.strictEqual(helper.sid, "local-session");
    assert.strictEqual((await helper.fetchPersonalPhotos(0, 1)).success, true);
    assert(requests.some((req) => req.url.startsWith("/photo/webapi/auth.cgi?") &&
      req.referer === "https://127.0.0.1/"));

    let proxy;
    helper.expressApp = { get: (route, handler) => { proxy = handler; } };
    helper.setupProxy();
    const chunks = [];
    const output = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
    const headers = {};
    output.setHeader = (name, value) => { headers[name] = value; };
    const finished = new Promise((resolve, reject) => { output.on("finish", resolve); output.on("error", reject); });
    await proxy({ query: { url: base + "/image" } }, output);
    await finished;
    assert.strictEqual(Buffer.concat(chunks).toString(), "thumbnail-bytes");
    assert.strictEqual(headers["Content-Type"], "image/jpeg");

    const diagnostic = loadEntry("test_connection.js");
    const diagnosticResponse = await diagnostic.synoFetch(base + "/redirect", "local.test");
    assert.strictEqual((await diagnosticResponse.buffer()).toString(), "thumbnail-bytes");
    assert(requests.some((req) => req.url === "/image" && req.referer === "https://local.test/"));
    console.log("PASS: CommonJS loader, redirects/agent, helper login/list/proxy, diagnostic buffer/Referer");
  } finally {
    agent.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
