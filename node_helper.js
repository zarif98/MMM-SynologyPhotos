const NodeHelper = require("node_helper");
const fetch = require("node-fetch");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const TOKEN_FILE = path.join(__dirname, "device_token.json");

// Allow self-signed certificates common on Synology NAS devices
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const httpAgent = new http.Agent();

/**
 * Fetch wrapper for Synology API calls.
 * Includes a Referer header matching the server URL, which is required
 * for QuickConnect to return JSON API responses instead of HTML.
 */
async function synoFetch(url, serverUrl) {
  const agent = url.startsWith("https") ? httpsAgent : httpAgent;
  const headers = {};
  if (serverUrl) {
    headers["Referer"] = `https://${serverUrl}/`;
  }
  const response = await fetch(url, { agent, headers });
  return response;
}

module.exports = NodeHelper.create({
  start: function () {
    console.log("[MMM-SynologyPhotos] Node helper started");
    this.sid = null;
    this.photos = [];
    this.refreshTimer = null;
    this.setupProxy();
  },

  setupProxy: function () {
    const self = this;
    this.expressApp.get("/synology-photos/image", async (req, res) => {
      const targetUrl = req.query.url;
      if (!targetUrl) return res.status(400).send("Missing URL");

      try {
        const response = await synoFetch(targetUrl, self.config.serverUrl);
        if (!response.ok) {
          return res.status(response.status).send(response.statusText);
        }
        res.setHeader("Content-Type", response.headers.get("content-type") || "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24h
        response.body.pipe(res);
      } catch (err) {
        console.error("[MMM-SynologyPhotos] Proxy error:", err.message);
        res.status(500).send("Proxy error");
      }
    });
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "SYNOLOGY_PHOTOS_FETCH") {
      this.config = payload;
      this.fetchPhotos();
    }
  },

  /**
   * Load saved device token for 2FA bypass.
   */
  loadDeviceToken: function () {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
        if (data.device_id) {
          console.log("[MMM-SynologyPhotos] Loaded device token for 2FA bypass");
          return data.device_id;
        }
      }
    } catch (error) {
      console.warn("[MMM-SynologyPhotos] Could not read device token:", error.message);
    }
    return null;
  },

  /**
   * Authenticate with the Synology API and obtain a session ID.
   * If a device token exists, uses it to bypass 2FA OTP.
   */
  login: async function () {
    const { serverUrl, account, password, port, secure } = this.config;
    const protocol = secure ? "https" : "http";
    const portStr = port ? `:${port}` : "";
    const baseUrl = `${protocol}://${serverUrl}${portStr}`;

    const apiPath = this.getApiPath();
    const loginUrl = `${baseUrl}${apiPath}/auth.cgi`;
    const params = new URLSearchParams({
      api: "SYNO.API.Auth",
      version: "6",
      method: "login",
      account: account,
      passwd: password,
    });

    // Add device_id for 2FA bypass if available
    const deviceId = this.loadDeviceToken();
    if (deviceId) {
      params.set("device_id", deviceId);
      params.set("device_name", "MagicMirror");
    }

    try {
      const response = await synoFetch(`${loginUrl}?${params.toString()}`, serverUrl);
      const data = await response.json();

      if (data.success && data.data && data.data.sid) {
        this.sid = data.data.sid;
        console.log("[MMM-SynologyPhotos] Login successful");
        return true;
      } else {
        const errCode = data.error ? data.error.code : "unknown";
        console.error("[MMM-SynologyPhotos] Login failed (error code: " + errCode + "):", JSON.stringify(data));
        if (errCode === 403 || errCode === 404) {
          console.error("[MMM-SynologyPhotos] 2FA error — re-run: cd ~/MagicMirror/modules/MMM-SynologyPhotos && node setup_device_token.js");
        }
        return false;
      }
    } catch (error) {
      console.error("[MMM-SynologyPhotos] Login error:", error.message);
      return false;
    }
  },

  /**
   * Detect if the server URL is a QuickConnect address.
   */
  isQuickConnect: function () {
    return (this.config.serverUrl || "").includes("quickconnect.to");
  },

  /**
   * Build the base URL for API requests.
   */
  getBaseUrl: function () {
    const { serverUrl, port, secure } = this.config;
    const protocol = secure !== false ? "https" : "http";
    const portStr = port ? `:${port}` : "";
    return `${protocol}://${serverUrl}${portStr}`;
  },

  /**
   * Get the webapi path prefix.
   * QuickConnect blocks /photo/webapi/ (403), so use /webapi/ instead.
   * Direct IP/LAN connections use the standard /photo/webapi/ path.
   */
  getApiPath: function () {
    return this.isQuickConnect() ? "/webapi" : "/photo/webapi";
  },

  /**
   * Fetch photos from personal space using SYNO.Foto.Browse.Item.
   */
  fetchPersonalPhotos: async function (offset, limit) {
    const baseUrl = this.getBaseUrl();
    const apiPath = this.getApiPath();
    const url = `${baseUrl}${apiPath}/entry.cgi`;
    const params = new URLSearchParams({
      api: "SYNO.Foto.Browse.Item",
      version: "1",
      method: "list",
      type: "photo",
      offset: offset.toString(),
      limit: limit.toString(),
      _sid: this.sid,
      additional: '["thumbnail","resolution"]',
    });

    const response = await synoFetch(`${url}?${params.toString()}`, this.config.serverUrl);
    return response.json();
  },

  /**
   * Fetch photos from shared/team space using SYNO.FotoTeam.Browse.Item.
   */
  fetchTeamPhotos: async function (offset, limit) {
    const baseUrl = this.getBaseUrl();
    const apiPath = this.getApiPath();
    const url = `${baseUrl}${apiPath}/entry.cgi`;
    const params = new URLSearchParams({
      api: "SYNO.FotoTeam.Browse.Item",
      version: "1",
      method: "list",
      type: "photo",
      offset: offset.toString(),
      limit: limit.toString(),
      _sid: this.sid,
      additional: '["thumbnail","resolution"]',
    });

    const response = await synoFetch(`${url}?${params.toString()}`, this.config.serverUrl);
    return response.json();
  },

  /**
   * Fetch photos from a specific album by ID.
   */
  fetchAlbumPhotos: async function (albumId, offset, limit) {
    const baseUrl = this.getBaseUrl();
    const apiPath = this.getApiPath();
    const url = `${baseUrl}${apiPath}/entry.cgi`;
    const params = new URLSearchParams({
      api: "SYNO.Foto.Browse.Item",
      version: "1",
      method: "list",
      type: "photo",
      offset: offset.toString(),
      limit: limit.toString(),
      album_id: albumId.toString(),
      _sid: this.sid,
      additional: '["thumbnail","resolution"]',
    });

    const response = await synoFetch(`${url}?${params.toString()}`, this.config.serverUrl);
    return response.json();
  },

  /**
   * Fetch photos from a specific folder by ID.
   */
  fetchFolderPhotos: async function (folderId, offset, limit) {
    const baseUrl = this.getBaseUrl();
    const apiPath = this.getApiPath();
    const url = `${baseUrl}${apiPath}/entry.cgi`;
    const params = new URLSearchParams({
      api: "SYNO.Foto.Browse.Item",
      version: "1",
      method: "list",
      type: "photo",
      offset: offset.toString(),
      limit: limit.toString(),
      folder_id: folderId.toString(),
      _sid: this.sid,
      additional: '["thumbnail","resolution"]',
    });

    const response = await synoFetch(`${url}?${params.toString()}`, this.config.serverUrl);
    return response.json();
  },

  /**
   * Build a thumbnail URL for a given photo object.
   */
  buildThumbnailUrl: function (photo, size) {
    const baseUrl = this.getBaseUrl();
    const cacheKey = photo.additional.thumbnail.cache_key;
    const apiName = this.config.sharedSpace
      ? "SYNO.FotoTeam.Thumbnail"
      : "SYNO.Foto.Thumbnail";

    const apiPath = this.getApiPath();
    return (
      `${baseUrl}${apiPath}/entry.cgi` +
      `?api=${apiName}` +
      `&version=1` +
      `&method=get` +
      `&mode=download` +
      `&id=${photo.id}` +
      `&type=unit` +
      `&size=${size}` +
      `&cache_key=${cacheKey}` +
      `&_sid=${this.sid}`
    );
  },

  /**
   * Main fetch orchestrator: login, gather photos, send to frontend.
   */
  fetchPhotos: async function () {
    try {
      const loggedIn = await this.login();
      if (!loggedIn) {
        this.sendSocketNotification("SYNOLOGY_PHOTOS_ERROR", {
          error: "Login failed. Check your credentials and server URL.",
        });
        return;
      }

      const limit = this.config.numPhotos || 100;
      const thumbnailSize = this.config.thumbnailSize || "xl";
      let photoList = [];

      if (this.config.albumId) {
        const data = await this.fetchAlbumPhotos(this.config.albumId, 0, limit);
        if (data.success) photoList = data.data.list;
      } else if (this.config.folderId) {
        const data = await this.fetchFolderPhotos(this.config.folderId, 0, limit);
        if (data.success) photoList = data.data.list;
      } else if (this.config.sharedSpace) {
        const data = await this.fetchTeamPhotos(0, limit);
        if (data.success) photoList = data.data.list;
      } else {
        const data = await this.fetchPersonalPhotos(0, limit);
        if (data.success) photoList = data.data.list;
      }

      // Filter to only items that have a ready thumbnail
      const photos = photoList
        .filter(
          (p) =>
            p.additional &&
            p.additional.thumbnail &&
            (p.additional.thumbnail[thumbnailSize] === "ready" ||
              p.additional.thumbnail[thumbnailSize] === true)
        )
        .map((p) => ({
          id: p.id,
          filename: p.filename,
          url: "/synology-photos/image?url=" + encodeURIComponent(this.buildThumbnailUrl(p, thumbnailSize)),
          width: p.additional.resolution ? p.additional.resolution.width : null,
          height: p.additional.resolution ? p.additional.resolution.height : null,
          time: p.time,
        }));

      if (this.config.shuffle) {
        for (let i = photos.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [photos[i], photos[j]] = [photos[j], photos[i]];
        }
      } else if (this.config.sortBy === "time") {
        photos.sort((a, b) => b.time - a.time);
      }

      this.photos = photos;
      this.sendSocketNotification("SYNOLOGY_PHOTOS_DATA", { photos });
      console.log(`[MMM-SynologyPhotos] Fetched ${photos.length} photos`);

      // Schedule periodic refresh
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      const refreshInterval = this.config.refreshInterval || 3600000; // default 1 hour
      this.refreshTimer = setTimeout(() => {
        this.fetchPhotos();
      }, refreshInterval);
    } catch (error) {
      console.error("[MMM-SynologyPhotos] Fetch error:", error.message);
      this.sendSocketNotification("SYNOLOGY_PHOTOS_ERROR", {
        error: error.message,
      });
    }
  },
});
