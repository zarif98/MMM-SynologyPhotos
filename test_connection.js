#!/usr/bin/env node

/**
 * MMM-SynologyPhotos — Connection Diagnostic Tool
 *
 * Tests your Synology NAS connection step by step:
 *   1. Resolves your server (QuickConnect, DDNS, or direct IP)
 *   2. Finds the working API endpoint
 *   3. Authenticates (supports 2FA with device token)
 *   4. Fetches sample photos
 *   5. Downloads a test thumbnail
 *   6. Outputs a ready-to-use MagicMirror config
 *
 * Usage:
 *   node test_connection.js <server> <username> <password> [otp_code]
 *
 * Examples:
 *   # QuickConnect
 *   node test_connection.js mynas.quickconnect.to myuser mypass
 *
 *   # QuickConnect with 2FA OTP (first time only)
 *   node test_connection.js mynas.quickconnect.to myuser mypass 913484
 *
 *   # Direct IP on your home network
 *   node test_connection.js 192.168.1.100:5001 myuser mypass
 *
 *   # DDNS hostname
 *   node test_connection.js mynas.synology.me:5001 myuser mypass
 */

const fetch = require("node-fetch");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const httpAgent = new http.Agent();
const TOKEN_FILE = path.join(__dirname, "device_token.json");

// ─── Logging helpers ───
function divider(title) {
  console.log();
  console.log("=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}
function pass(msg) { console.log(`  [PASS] ${msg}`); }
function fail(msg) { console.log(`  [FAIL] ${msg}`); }
function info(msg) { console.log(`  [INFO] ${msg}`); }
function warn(msg) { console.log(`  [WARN] ${msg}`); }

// ─── Fetch wrapper with Referer header (required for QuickConnect) ───
async function synoFetch(url, refererHost) {
  const agent = url.startsWith("https") ? httpsAgent : httpAgent;
  const headers = {};
  if (refererHost) headers["Referer"] = `https://${refererHost}/`;
  return fetch(url, { agent, headers, redirect: "follow", timeout: 12000 });
}

// ─── Parse server argument into structured config ───
function parseServer(serverArg) {
  // Strip protocol if user included it
  let raw = serverArg.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  const isQuickConnect = raw.includes("quickconnect.to");

  // Split host:port
  let host, port;
  if (isQuickConnect) {
    host = raw;
    port = null; // QuickConnect uses 443 implicitly
  } else {
    const parts = raw.split(":");
    host = parts[0];
    port = parts[1] ? parseInt(parts[1], 10) : 5001;
  }

  return { host, port, isQuickConnect };
}

// ─── Try an API endpoint and return { ok, apiCount } ───
async function testApiEndpoint(baseUrl, apiPath, refererHost) {
  try {
    const url = `${baseUrl}${apiPath}/entry.cgi?api=SYNO.API.Info&version=1&method=query`;
    const resp = await synoFetch(url, refererHost);
    const text = await resp.text();
    if (text.startsWith("{")) {
      const data = JSON.parse(text);
      if (data.success) {
        return { ok: true, apiCount: Object.keys(data.data || {}).length, data: data.data };
      }
    }
    return { ok: false, status: resp.status, preview: text.substring(0, 100) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Resolve QuickConnect to candidate URLs via Synology relay ───
async function resolveQuickConnect(fullDomain) {
  const parts = fullDomain.replace(/\.quickconnect\.to$/, "").split(".");
  const serverID = parts[0];
  const region = parts[1] || null;

  info(`Server ID: ${serverID}, Region: ${region || "global"}`);

  const candidates = [];
  const relayPayload = JSON.stringify({
    version: 1,
    command: "get_server_info",
    stop_when_error: false,
    stop_when_success: false,
    id: "dsm_portal_https",
    serverID: serverID,
  });

  const relayUrls = [
    region ? `https://${region}.quickconnect.to/Serv.php` : null,
    "https://global.quickconnect.to/Serv.php",
  ].filter(Boolean);

  for (const relayUrl of relayUrls) {
    try {
      info(`Querying relay: ${relayUrl}`);
      const resp = await fetch(relayUrl, {
        method: "POST",
        body: relayPayload,
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });
      const data = await resp.json();

      if (data && data.server) {
        const srv = data.server;
        const httpsPort = srv.external?.port || 5001;

        if (srv.interface) {
          for (const iface of srv.interface) {
            if (iface.ip) {
              info(`  LAN IP: ${iface.ip}`);
              candidates.push({ url: `https://${iface.ip}:${iface.port || 5001}`, label: `LAN (${iface.ip})` });
            }
          }
        }
        if (srv.ddns) {
          info(`  DDNS: ${srv.ddns}`);
          candidates.push({ url: `https://${srv.ddns}:${httpsPort}`, label: `DDNS (${srv.ddns})` });
        }
        if (srv.external?.ip) {
          info(`  External: ${srv.external.ip}:${httpsPort}`);
          candidates.push({ url: `https://${srv.external.ip}:${httpsPort}`, label: `External IP` });
        }
        break;
      }
    } catch (err) {
      warn(`Relay error: ${err.message.substring(0, 80)}`);
    }
  }

  // QuickConnect direct URL (always works as relay proxy)
  candidates.push({ url: `https://${fullDomain}`, label: `QuickConnect` });

  return candidates;
}

// ─── Main ───
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log(`
  MMM-SynologyPhotos — Connection Test Tool

  Usage:
    node test_connection.js <server> <username> <password> [otp_code]

  Examples:
    node test_connection.js mynas.quickconnect.to admin MyPass123
    node test_connection.js mynas.quickconnect.to admin MyPass123 913484
    node test_connection.js 192.168.1.100:5001 admin MyPass123
    node test_connection.js mynas.synology.me:5001 admin MyPass123

  The <server> can be:
    - A QuickConnect URL  (e.g. mynas.quickconnect.to)
    - A direct LAN IP     (e.g. 192.168.1.100 or 192.168.1.100:5001)
    - A DDNS hostname     (e.g. mynas.synology.me:5001)

  If your account has 2FA enabled, include your authenticator OTP code
  as the 4th argument. A device token will be saved so you only need
  to do this once.
`);
    process.exit(1);
  }

  const serverArg = args[0];
  const account = args[1];
  const password = args[2];
  const otpCode = args[3] || null;
  const server = parseServer(serverArg);

  console.log();
  console.log("============================================================");
  console.log("  MMM-SynologyPhotos — Connection Diagnostic");
  console.log("============================================================");
  console.log(`  Server:  ${serverArg} ${server.isQuickConnect ? "(QuickConnect)" : `(direct, port ${server.port})`}`);
  console.log(`  User:    ${account}`);
  console.log(`  2FA OTP: ${otpCode ? "provided" : "not provided (use 4th arg if needed)"}`);

  // ══════════════════════════════════════════════════════
  //  STEP 1: Find a working connection
  // ══════════════════════════════════════════════════════
  divider("STEP 1: Finding Your NAS");

  let candidates = [];

  if (server.isQuickConnect) {
    candidates = await resolveQuickConnect(server.host);
  } else {
    const protocol = server.port === 5000 ? "http" : "https";
    candidates = [
      { url: `${protocol}://${server.host}:${server.port}`, label: "Direct" },
    ];
  }

  info(`Testing ${candidates.length} connection(s)...\n`);

  // For each candidate, try both /webapi/ and /photo/webapi/ paths
  let workingBase = null;
  let workingPath = null;

  for (const c of candidates) {
    for (const apiPath of ["/webapi", "/photo/webapi"]) {
      const result = await testApiEndpoint(c.url, apiPath, server.host);
      if (result.ok) {
        pass(`${c.label} + ${apiPath} => ${result.apiCount} APIs`);
        workingBase = c.url;
        workingPath = apiPath;
        break;
      } else {
        const reason = result.error || `HTTP ${result.status}`;
        warn(`${c.label} + ${apiPath} => ${reason}`);
      }
    }
    if (workingBase) break;
  }

  if (!workingBase) {
    fail("Could not reach your Synology NAS.");
    console.log("\n  Troubleshooting:");
    console.log("    1. Make sure your NAS is powered on");
    console.log("    2. If using a LAN IP, ensure you're on the same network");
    console.log("    3. If using QuickConnect, verify it's enabled in DSM > External Access");
    console.log("    4. Try opening in a browser: https://" + serverArg + "/photo");
    console.log("    5. Check your firewall isn't blocking the connection");
    process.exit(1);
  }

  console.log();
  pass(`Connected! Using: ${workingBase} (path: ${workingPath})`);

  // ══════════════════════════════════════════════════════
  //  STEP 2: Check available APIs
  // ══════════════════════════════════════════════════════
  divider("STEP 2: Checking Synology Photos APIs");

  const apiResult = await testApiEndpoint(workingBase, workingPath, server.host);
  if (apiResult.ok && apiResult.data) {
    const apis = Object.keys(apiResult.data);
    const fotoApis = apis.filter(a => a.includes("Foto"));
    pass(`${apis.length} total APIs, ${fotoApis.length} Synology Photos APIs`);

    const required = ["SYNO.API.Auth", "SYNO.Foto.Browse.Item", "SYNO.Foto.Thumbnail"];
    for (const api of required) {
      if (apis.includes(api)) pass(`  ${api}`);
      else fail(`  ${api} — MISSING (is Synology Photos installed?)`);
    }
  }

  // ══════════════════════════════════════════════════════
  //  STEP 3: Authenticate
  // ══════════════════════════════════════════════════════
  divider("STEP 3: Authentication");

  // Load device token if available
  let deviceId = null;
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      deviceId = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")).device_id;
      info("Loaded saved device token (2FA bypass)");
    } catch (e) {
      warn(`Could not read device_token.json: ${e.message}`);
    }
  }

  const loginParams = new URLSearchParams({
    api: "SYNO.API.Auth",
    version: "6",
    method: "login",
    account: account,
    passwd: password,
  });

  if (deviceId) {
    loginParams.set("device_id", deviceId);
    loginParams.set("device_name", "MagicMirror");
    info("Using device token for 2FA bypass");
  }
  if (otpCode) {
    loginParams.set("otp_code", otpCode);
    loginParams.set("enable_device_token", "yes");
    loginParams.set("device_name", "MagicMirror");
    info("Sending OTP code + requesting device token");
  }
  if (!deviceId && !otpCode) {
    info("No device token and no OTP — will work if 2FA is disabled");
  }

  let sid = null;

  // Try auth.cgi first, then entry.cgi as fallback
  for (const authEndpoint of [`${workingPath}/auth.cgi`, `${workingPath}/entry.cgi`]) {
    if (sid) break;
    try {
      const loginUrl = `${workingBase}${authEndpoint}?${loginParams.toString()}`;
      const resp = await synoFetch(loginUrl, server.host);
      const text = await resp.text();

      if (!text.startsWith("{")) continue;
      const data = JSON.parse(text);

      if (data.success && data.data && data.data.sid) {
        sid = data.data.sid;
        pass(`Login successful via ${authEndpoint}`);

        // Save device token if returned
        const did = data.data.did || data.data.device_id;
        if (did && otpCode) {
          fs.writeFileSync(TOKEN_FILE, JSON.stringify({
            device_id: did,
            server_url: server.host,
            created: new Date().toISOString(),
            device_name: "MagicMirror",
          }, null, 2));
          pass("Device token saved! You won't need OTP again.");
        }
      } else if (data.error) {
        const code = data.error.code;
        warn(`${authEndpoint} returned error ${code}`);
      }
    } catch (err) {
      warn(`${authEndpoint}: ${err.message.substring(0, 60)}`);
    }
  }

  if (!sid) {
    fail("Authentication failed.");
    console.log("\n  Troubleshooting:");
    console.log("    - Error 400: Wrong username or password");
    console.log("    - Error 401: Account is disabled");
    console.log("    - Error 402: No permission");
    console.log("    - Error 403: Invalid OTP code or expired device token");
    console.log("                 Re-run with a fresh OTP code from your authenticator app");
    console.log("    - Error 404: 2FA is enabled — you must provide an OTP code:");
    console.log(`                 node test_connection.js ${serverArg} ${account} YOUR_PASS OTP_CODE`);
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════
  //  STEP 4: Fetch Photos
  // ══════════════════════════════════════════════════════
  divider("STEP 4: Fetching Photos");

  let photoList = [];
  let usedSpace = "Personal";

  // Try Personal Space first, then Shared Space
  for (const [space, api] of [["Personal", "SYNO.Foto.Browse.Item"], ["Shared", "SYNO.FotoTeam.Browse.Item"]]) {
    const params = new URLSearchParams({
      api: api,
      version: "1",
      method: "list",
      type: "photo",
      offset: "0",
      limit: "5",
      _sid: sid,
      additional: '["thumbnail","resolution"]',
    });

    try {
      const resp = await synoFetch(`${workingBase}${workingPath}/entry.cgi?${params.toString()}`, server.host);
      const data = await resp.json();

      if (data.success && data.data && data.data.list && data.data.list.length > 0) {
        photoList = data.data.list;
        usedSpace = space;
        pass(`Found ${photoList.length} photos in ${space} Space (total: ${data.data.total || "?"})`);
        break;
      } else {
        info(`${space} Space: ${data.success ? "0 photos" : "error " + (data.error?.code || "?")}`);
      }
    } catch (err) {
      warn(`${space} Space: ${err.message.substring(0, 60)}`);
    }
  }

  if (photoList.length === 0) {
    fail("No photos found in either Personal or Shared space.");
    console.log("  Make sure you have photos uploaded in Synology Photos.");
  } else {
    photoList.forEach((p, i) => {
      const thumb = p.additional && p.additional.thumbnail;
      const sizes = thumb
        ? Object.entries(thumb).filter(([, v]) => v === "ready").map(([k]) => k).join(", ")
        : "none";
      info(`  [${i + 1}] ${p.filename} (id: ${p.id}) — thumbnails: ${sizes}`);
    });
  }

  // ══════════════════════════════════════════════════════
  //  STEP 5: Download Thumbnail
  // ══════════════════════════════════════════════════════
  if (photoList.length > 0) {
    divider("STEP 5: Testing Thumbnail Download");

    const testPhoto = photoList.find(
      (p) => p.additional?.thumbnail?.xl === "ready" ||
             p.additional?.thumbnail?.m === "ready" ||
             p.additional?.thumbnail?.sm === "ready"
    );

    if (testPhoto) {
      const thumb = testPhoto.additional.thumbnail;
      const size = thumb.xl === "ready" ? "xl" : thumb.m === "ready" ? "m" : "sm";
      const cacheKey = thumb.cache_key;
      const thumbApi = usedSpace === "Shared" ? "SYNO.FotoTeam.Thumbnail" : "SYNO.Foto.Thumbnail";

      const thumbUrl = `${workingBase}${workingPath}/entry.cgi?api=${thumbApi}&version=1&method=get&mode=download&id=${testPhoto.id}&type=unit&size=${size}&cache_key=${cacheKey}&_sid=${sid}`;

      info(`Downloading: ${testPhoto.filename} (${size} thumbnail)`);

      try {
        const resp = await synoFetch(thumbUrl, server.host);
        const ct = resp.headers.get("content-type") || "";

        if (ct.includes("image") || ct.includes("octet-stream")) {
          const buffer = await resp.buffer();
          const outFile = path.join(__dirname, "test_thumbnail.jpg");
          fs.writeFileSync(outFile, buffer);
          pass(`Downloaded ${(buffer.length / 1024).toFixed(1)} KB — saved to test_thumbnail.jpg`);
        } else {
          fail(`Unexpected response type: ${ct}`);
        }
      } catch (err) {
        fail(`Download error: ${err.message}`);
      }
    } else {
      warn("No photos with ready thumbnails found");
    }
  }

  // ══════════════════════════════════════════════════════
  //  RESULTS
  // ══════════════════════════════════════════════════════
  divider("ALL TESTS PASSED — Your Config");

  // Determine the config values to recommend
  const isQC = server.isQuickConnect;
  const configServerUrl = isQC ? server.host : server.host;
  const configPort = isQC ? "null" : String(server.port);
  const configSecure = isQC ? "true" : (server.port === 5000 ? "false" : "true");
  const configSharedSpace = usedSpace === "Shared" ? "true" : "false";

  console.log();
  console.log("  Add this to your MagicMirror config/config.js:");
  console.log();
  console.log("  {");
  console.log('    module: "MMM-SynologyPhotos",');
  console.log('    position: "middle_center",');
  console.log("    config: {");
  console.log(`      serverUrl: "${configServerUrl}",`);
  console.log(`      port: ${configPort},`);
  console.log(`      secure: ${configSecure},`);
  console.log(`      account: "${account}",`);
  console.log(`      password: "YOUR_PASSWORD",`);
  if (configSharedSpace === "true") {
    console.log(`      sharedSpace: true,`);
  }
  console.log("    }");
  console.log("  }");
  console.log();

  if (isQC) {
    info("QuickConnect detected — the module auto-selects the right API path.");
  }
  if (fs.existsSync(TOKEN_FILE)) {
    info("Device token is saved — 2FA login will work automatically.");
    info("If you move this module to your MagicMirror, copy device_token.json too.");
  }
  console.log();

  // Logout
  try {
    await synoFetch(`${workingBase}${workingPath}/auth.cgi?api=SYNO.API.Auth&version=6&method=logout&_sid=${sid}`, server.host);
  } catch (_) {}
}

main().catch((err) => {
  console.error("\n  Fatal error:", err.message);
  console.error("  If this persists, open an issue at:");
  console.error("  https://github.com/zarif98/MMM-SynologyPhotos/issues");
  process.exit(1);
});
