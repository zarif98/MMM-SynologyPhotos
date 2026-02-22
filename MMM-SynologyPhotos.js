Module.register("MMM-SynologyPhotos", {
  // Size presets: { width, height } in pixels
  SIZE_PRESETS: {
    small:      { width: 300,  height: 200  },
    medium:     { width: 480,  height: 320  },
    large:      { width: 800,  height: 600  },
    xlarge:     { width: 1024, height: 768  },
    fullscreen: { width: null, height: null },  // stretches to fill region
  },

  defaults: {
    serverUrl: "",           // Synology NAS IP or hostname
    port: 5001,              // Port (5001 for HTTPS, 5000 for HTTP)
    secure: true,            // Use HTTPS
    account: "",             // Synology account username
    password: "",            // Synology account password
    sharedSpace: false,      // true = Shared Space, false = Personal Space
    albumId: null,           // Specific album ID to fetch from (optional)
    folderId: null,          // Specific folder ID to fetch from (optional)
    numPhotos: 100,          // Max number of photos to fetch
    thumbnailSize: "auto",   // "sm" (240px), "m" (320px), "xl" (1280px), or "auto"
    shuffle: true,           // Randomize photo order
    sortBy: "time",          // Sort by "time" if shuffle is false
    slideshowSpeed: 15000,   // Time per photo in ms (15 seconds)
    transitionSpeed: 2000,   // Crossfade transition duration in ms
    refreshInterval: 3600000, // Re-fetch photos every hour
    backgroundSize: "cover", // CSS object-fit: "cover", "contain", "fill"
    showFilename: false,     // Show filename overlay
    showDate: false,         // Show photo date overlay
    showCounter: true,       // Show photo counter badge

    // --- Sizing options (pick ONE approach) ---
    sizePreset: null,        // "small", "medium", "large", "xlarge", "fullscreen", or null
    width: null,             // Custom width in px (e.g. 600). Overrides preset.
    height: null,            // Custom height in px (e.g. 400). Overrides preset.
    maxWidth: "100%",        // CSS max-width fallback
    maxHeight: "100%",       // CSS max-height fallback
  },

  getStyles: function () {
    return ["MMM-SynologyPhotos.css"];
  },

  start: function () {
    Log.info("[MMM-SynologyPhotos] Starting module");
    this.photos = [];
    this.currentIndex = 0;
    this.loaded = false;
    this.errorMessage = null;

    // Resolve sizing
    this.resolvedSize = this.resolveSize();

    // Auto-select thumbnail quality based on widget size
    if (this.config.thumbnailSize === "auto") {
      var w = this.resolvedSize.width;
      if (!w || w > 800) {
        this.config.thumbnailSize = "xl";
      } else if (w > 320) {
        this.config.thumbnailSize = "m";
      } else {
        this.config.thumbnailSize = "sm";
      }
      Log.info("[MMM-SynologyPhotos] Auto thumbnail size: " + this.config.thumbnailSize);
    }

    this.sendSocketNotification("SYNOLOGY_PHOTOS_FETCH", this.config);
  },

  /**
   * Resolve the final widget size from preset, custom, or fallback values.
   * Returns { width: number|null, height: number|null, cssWidth: string, cssHeight: string }
   */
  resolveSize: function () {
    var width = null;
    var height = null;

    // 1) Start from preset if specified
    if (this.config.sizePreset && this.SIZE_PRESETS[this.config.sizePreset]) {
      var preset = this.SIZE_PRESETS[this.config.sizePreset];
      width = preset.width;
      height = preset.height;
    }

    // 2) Custom width/height override preset
    if (this.config.width) width = this.config.width;
    if (this.config.height) height = this.config.height;

    return {
      width: width,
      height: height,
      cssWidth: width ? width + "px" : this.config.maxWidth,
      cssHeight: height ? height + "px" : this.config.maxHeight,
    };
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "SYNOLOGY_PHOTOS_DATA") {
      this.photos = payload.photos;
      this.loaded = true;
      this.errorMessage = null;
      this.currentIndex = 0;
      this.updateDom(this.config.transitionSpeed);
      this.startSlideshow();
    } else if (notification === "SYNOLOGY_PHOTOS_ERROR") {
      this.errorMessage = payload.error;
      this.loaded = true;
      this.updateDom();
    }
  },

  startSlideshow: function () {
    if (this.slideshowTimer) clearInterval(this.slideshowTimer);
    if (this.photos.length <= 1) return;

    this.slideshowTimer = setInterval(() => {
      this.currentIndex = (this.currentIndex + 1) % this.photos.length;
      this.updateDom(this.config.transitionSpeed);
    }, this.config.slideshowSpeed);
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "synology-photos-wrapper";

    // Apply resolved sizing
    var size = this.resolvedSize || this.resolveSize();
    if (size.width) {
      wrapper.style.width = size.cssWidth;
      wrapper.style.maxWidth = size.cssWidth;
    } else {
      wrapper.style.maxWidth = this.config.maxWidth;
    }
    if (size.height) {
      wrapper.style.height = size.cssHeight;
      wrapper.style.maxHeight = size.cssHeight;
    } else {
      wrapper.style.maxHeight = this.config.maxHeight;
    }

    if (!this.loaded) {
      wrapper.innerHTML = '<div class="synology-photos-loading">Loading photos&hellip;</div>';
      return wrapper;
    }

    if (this.errorMessage) {
      wrapper.innerHTML =
        '<div class="synology-photos-error">' + this.errorMessage + "</div>";
      return wrapper;
    }

    if (this.photos.length === 0) {
      wrapper.innerHTML =
        '<div class="synology-photos-empty">No photos found.</div>';
      return wrapper;
    }

    const photo = this.photos[this.currentIndex];

    const imgContainer = document.createElement("div");
    imgContainer.className = "synology-photos-container";

    const img = document.createElement("img");
    img.className = "synology-photos-image";
    img.src = photo.url;
    img.alt = photo.filename || "Synology Photo";
    img.style.objectFit = this.config.backgroundSize;
    imgContainer.appendChild(img);

    if (this.config.showFilename || this.config.showDate) {
      const overlay = document.createElement("div");
      overlay.className = "synology-photos-overlay";

      if (this.config.showFilename) {
        const nameEl = document.createElement("span");
        nameEl.className = "synology-photos-filename";
        nameEl.textContent = photo.filename;
        overlay.appendChild(nameEl);
      }

      if (this.config.showDate && photo.time) {
        const dateEl = document.createElement("span");
        dateEl.className = "synology-photos-date";
        const date = new Date(photo.time * 1000);
        dateEl.textContent = date.toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        overlay.appendChild(dateEl);
      }

      imgContainer.appendChild(overlay);
    }

    if (this.config.showCounter) {
      const counter = document.createElement("div");
      counter.className = "synology-photos-counter";
      counter.textContent = `${this.currentIndex + 1} / ${this.photos.length}`;
      imgContainer.appendChild(counter);
    }

    wrapper.appendChild(imgContainer);
    return wrapper;
  },

  suspend: function () {
    if (this.slideshowTimer) clearInterval(this.slideshowTimer);
  },

  resume: function () {
    if (this.photos.length > 1) this.startSlideshow();
  },
});
