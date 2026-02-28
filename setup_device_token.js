#!/usr/bin/env node

/**
 * MMM-SynologyPhotos — One-time Device Token Setup
 *
 * Run this script once to register your MagicMirror as a trusted device
 * with your Synology NAS. This allows the module to log in without
 * needing a 2FA OTP code on every restart.
 *
 * Usage:
 *   cd ~/MagicMirror/modules/MMM-SynologyPhotos
 *   node setup_device_token.js
 */

const fetch = require("node-fetch");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const httpAgent = new http.Agent();

const TOKEN_FILE = path.join(__dirname, "device_token.json");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function ask(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
}


/**
 * Fetch with Referer header (required for QuickConnect to return JSON).
 */
async function synoFetch(url, serverUrl) {
    const agent = url.startsWith("https") ? httpsAgent : httpAgent;
    const headers = {};
    if (serverUrl) {
        headers["Referer"] = `https://${serverUrl}/`;
    }
    return fetch(url, { agent, headers });
}

async function main() {
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  MMM-SynologyPhotos — Device Token Setup    ║");
    console.log("║  Register this device for 2FA-free login    ║");
    console.log("╚══════════════════════════════════════════════╝");
    console.log();

    // Check for existing token
    if (fs.existsSync(TOKEN_FILE)) {
        const overwrite = await ask(
            "A device token already exists. Overwrite? (y/N): "
        );
        if (overwrite.toLowerCase() !== "y") {
            console.log("Aborted.");
            rl.close();
            process.exit(0);
        }
    }

    const serverUrl = await ask(
        "Synology server URL (e.g., 192.168.1.100 or mynas.quickconnect.to): "
    );

    const portInput = await ask("Port (press Enter for none / QuickConnect): ");
    const port = portInput || null;

    const secureInput = await ask("Use HTTPS? (Y/n): ");
    const secure = secureInput.toLowerCase() !== "n";

    const account = await ask("Username: ");
    const password = await ask("Password: ");
    const otpCode = await ask("2FA OTP code (from authenticator app): ");

    // Build URL
    const protocol = secure ? "https" : "http";
    const portStr = port ? `:${port}` : "";
    const baseUrl = `${protocol}://${serverUrl}${portStr}`;
    const loginUrl = `${baseUrl}/photo/webapi/auth.cgi`;

    const params = new URLSearchParams({
        api: "SYNO.API.Auth",
        version: "6",
        method: "login",
        account: account,
        passwd: password,
        otp_code: otpCode,
        enable_device_token: "yes",
        device_name: "MagicMirror",
    });

    console.log();
    console.log("Authenticating...");

    try {
        const response = await synoFetch(
            `${loginUrl}?${params.toString()}`, serverUrl
        );
        const data = await response.json();

        if (data.success && data.data) {
            const deviceId = data.data.did || data.data.device_id;
            const sid = data.data.sid;

            if (!deviceId) {
                console.error(
                    "⚠ Login succeeded but no device_id was returned."
                );
                console.error("Response:", JSON.stringify(data, null, 2));
                console.error(
                    "Your DSM version may not support device tokens. Try creating a separate user without 2FA."
                );
                rl.close();
                process.exit(1);
            }

            // Save the device token
            const tokenData = {
                device_id: deviceId,
                server_url: serverUrl,
                port: port,
                secure: secure,
                created: new Date().toISOString(),
                device_name: "MagicMirror",
            };

            fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
            console.log();
            console.log("✅ Device registered successfully!");
            console.log(`   Device ID: ${deviceId.substring(0, 20)}...`);
            console.log(`   Saved to: ${TOKEN_FILE}`);
            console.log();
            console.log(
                "The module will now use this device token for future logins."
            );
            console.log("You won't need to enter an OTP code again.");

            // Logout
            try {
                await synoFetch(
                    `${baseUrl}/photo/webapi/auth.cgi?api=SYNO.API.Auth&version=6&method=logout&_sid=${sid}`, serverUrl
                );
            } catch (_) {
                // Ignore logout errors
            }
        } else {
            console.error("❌ Login failed!");
            console.error("Response:", JSON.stringify(data, null, 2));

            if (data.error) {
                const code = data.error.code;
                if (code === 400)
                    console.error("   → Invalid username or password");
                else if (code === 401)
                    console.error("   → Account disabled");
                else if (code === 402)
                    console.error("   → Permission denied");
                else if (code === 403)
                    console.error("   → Invalid OTP code");
                else if (code === 404)
                    console.error(
                        "   → OTP code required (2FA is enabled but no code provided)"
                    );
                else console.error(`   → Error code: ${code}`);
            }
        }
    } catch (error) {
        console.error("❌ Connection error:", error.message);
        console.error(
            "   Check that your server URL is correct and reachable."
        );
    }

    rl.close();
}

main().catch((err) => {
    console.error("Fatal error:", err);
    rl.close();
    process.exit(1);
});
