const NodeHelper = require("node_helper");
const fetch = require("node-fetch");
const https = require("https");

// Allow self-signed certificates common on Synology NAS devices
const agent = new https.Agent({ rejectUnauthorized: false });

module.exports = NodeHelper.create({
  start: function () {
    console.log("[MMM-SynologyPhotos] Node helper started");
    this.sid = null;
    this.photos = [];
    this.refreshTimer = null;
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "SYNOLOGY_PHOTOS_FETCH") {
      this.config = payload;
      this.fetchPhotos();
    }
  },

  /**
   * Authenticate with the Synology API and obtain a session ID.
   */
  login: async function () {
    const { serverUrl, account, password, port, secure } = this.config;
    const protocol = secure ? "https" : "http";
    const portStr = port ? `:${port}` : "";
    const baseUrl = `${protocol}://${serverUrl}${portStr}`;

    const loginUrl = `${baseUrl}/photo/webapi/auth.cgi`;
    const params = new URLSearchParams({
      api: "SYNO.API.Auth",
      version: "3",
      method: "login",
      account: account,
      passwd: password,
    });

    try {
      const response = await fetch(`${loginUrl}?${params.toString()}`, { agent });
      const data = await response.json();

      if (data.success && data.data && data.data.sid) {
        this.sid = data.data.sid;
        console.log("[MMM-SynologyPhotos] Login successful");
        return true;
      } else {
        console.error("[MMM-SynologyPhotos] Login failed:", JSON.stringify(data));
        return false;
      }
    } catch (error) {
      console.error("[MMM-SynologyPhotos] Login error:", error.message);
      return false;
    }
  },

  /**
   * Build the base URL for API requests.
   */
  getBaseUrl: function () {
    const { serverUrl, port, secure } = this.config;
    const protocol = secure ? "https" : "http";
    const portStr = port ? `:${port}` : "";
    return `${protocol}://${serverUrl}${portStr}`;
  },

  /**
   * Fetch photos from personal space using SYNO.Foto.Browse.Item.
   */
  fetchPersonalPhotos: async function (offset, limit) {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/photo/webapi/entry.cgi`;
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

    const response = await fetch(`${url}?${params.toString()}`, { agent });
    return response.json();
  },

  /**
   * Fetch photos from shared/team space using SYNO.FotoTeam.Browse.Item.
   */
  fetchTeamPhotos: async function (offset, limit) {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/photo/webapi/entry.cgi`;
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

    const response = await fetch(`${url}?${params.toString()}`, { agent });
    return response.json();
  },

  /**
   * Fetch photos from a specific album by ID.
   */
  fetchAlbumPhotos: async function (albumId, offset, limit) {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/photo/webapi/entry.cgi`;
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

    const response = await fetch(`${url}?${params.toString()}`, { agent });
    return response.json();
  },

  /**
   * Fetch photos from a specific folder by ID.
   */
  fetchFolderPhotos: async function (folderId, offset, limit) {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/photo/webapi/entry.cgi`;
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

    const response = await fetch(`${url}?${params.toString()}`, { agent });
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

    return (
      `${baseUrl}/photo/webapi/entry.cgi` +
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
            p.additional.thumbnail[thumbnailSize] === "ready"
        )
        .map((p) => ({
          id: p.id,
          filename: p.filename,
          url: this.buildThumbnailUrl(p, thumbnailSize),
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
