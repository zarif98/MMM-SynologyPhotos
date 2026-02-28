# MMM-SynologyPhotos

A [MagicMirror²](https://magicmirror.builders/) module that displays photos from your **Synology Photos** library as a slideshow on your smart mirror.

![MagicMirror²](https://img.shields.io/badge/MagicMirror²-Module-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D16-brightgreen)

<img src="images/example.png" alt="MMM-SynologyPhotos Example">

## Features

- **Personal Space & Shared Space** — Browse photos from either space
- **Album / Folder filtering** — Show photos from a specific album or folder
- **Crossfade slideshow** — Smooth transitions between photos
- **Shuffle & sort** — Randomize or sort by date
- **Auto-refresh** — Periodically re-fetches photos from your NAS
- **Metadata overlay** — Optionally show filename and date taken
- **Flexible sizing** — Presets (small/medium/large/xlarge/fullscreen) or custom pixel dimensions
- **Auto thumbnail quality** — Automatically selects the best resolution for your widget size

## Installation

### Via MMPM (recommended)

Install using [MMPM (MagicMirror Package Manager)](https://github.com/Bee-Mar/mmpm):

```bash
mmpm install MMM-SynologyPhotos
```

### Manual install

```bash
cd ~/MagicMirror/modules
git clone https://github.com/zarif98/MMM-SynologyPhotos.git
cd MMM-SynologyPhotos
npm install
```

## Test Your Connection

Before configuring the module, run the built-in diagnostic tool to verify your NAS is reachable and your credentials work:

```bash
cd ~/MagicMirror/modules/MMM-SynologyPhotos
node test_connection.js <server> <username> <password> [otp_code]
```

**Examples:**

```bash
# QuickConnect
node test_connection.js mynas.quickconnect.to myuser mypass

# Direct LAN IP
node test_connection.js 192.168.1.100:5001 myuser mypass

# With 2FA OTP code (first time only — saves a device token)
node test_connection.js mynas.quickconnect.to myuser mypass 913484
```

The tool will:
1. Find your NAS (resolves QuickConnect, tests LAN/DDNS/external IPs)
2. Verify the Synology Photos API is available
3. Authenticate (with 2FA support)
4. Fetch sample photos and download a test thumbnail
5. Output a ready-to-paste MagicMirror config

## 2FA Setup (Two-Factor Authentication)

If your Synology account has 2FA enabled, run `test_connection.js` with your OTP code as the 4th argument. This saves a device token so the module can log in without OTP in the future.

```bash
node test_connection.js mynas.quickconnect.to myuser mypass 913484
```

> **Note:** If you ever reset 2FA on your Synology account, re-run with a new OTP code to generate a fresh device token.

## Configuration

Add the following to the `modules` array in your `config/config.js`:

### Minimal example

```javascript
{
  module: "MMM-SynologyPhotos",
  position: "middle_center",
  config: {
    serverUrl: "192.168.1.100",
    port: 5001,
    secure: true,
    account: "your_username",
    password: "your_password",
  }
}
```

### Fullscreen photo frame

```javascript
{
  module: "MMM-SynologyPhotos",
  position: "fullscreen_above",
  config: {
    serverUrl: "192.168.1.100",
    port: 5001,
    secure: true,
    account: "your_username",
    password: "your_password",
    sizePreset: "fullscreen",
    slideshowSpeed: 30000,
    showDate: true,
  }
}
```

### Small sidebar widget

```javascript
{
  module: "MMM-SynologyPhotos",
  position: "top_right",
  config: {
    serverUrl: "192.168.1.100",
    port: 5001,
    secure: true,
    account: "your_username",
    password: "your_password",
    sizePreset: "small",
    showCounter: false,
  }
}
```

### Custom size from a specific album

```javascript
{
  module: "MMM-SynologyPhotos",
  position: "bottom_center",
  config: {
    serverUrl: "192.168.1.100",
    port: 5001,
    secure: true,
    account: "your_username",
    password: "your_password",
    albumId: 42,
    width: 700,
    height: 500,
    backgroundSize: "contain",
    showFilename: true,
    showDate: true,
  }
}
```

## Widget Sizing

You have three ways to control the widget size. They are evaluated in this priority order:

### 1. Custom pixel dimensions (highest priority)

Set `width` and/or `height` directly in pixels:

```javascript
config: {
  width: 600,
  height: 400,
}
```

### 2. Size presets

Use the `sizePreset` option for common sizes:

| Preset | Width | Height | Best for |
|---|---|---|---|
| `"small"` | 300px | 200px | Sidebar widget, corner placement |
| `"medium"` | 480px | 320px | Side panel, quarter-screen |
| `"large"` | 800px | 600px | Main area, half-screen |
| `"xlarge"` | 1024px | 768px | Dominant display |
| `"fullscreen"` | 100% | 100% | Full mirror background |

```javascript
config: {
  sizePreset: "medium",
}
```

### 3. CSS max-width / max-height (fallback)

If neither of the above are set, uses CSS strings:

```javascript
config: {
  maxWidth: "50%",
  maxHeight: "300px",
}
```

> **Tip:** You can mix approaches — e.g., use a preset but override just the width:
> ```javascript
> config: { sizePreset: "medium", width: 600 }
> ```
> This gives you 600×320.

### Auto thumbnail quality

When `thumbnailSize` is `"auto"` (the default), the module automatically picks the best Synology thumbnail resolution for your widget size:

| Widget width | Thumbnail selected | Resolution |
|---|---|---|
| ≤ 320px | `sm` | 240px |
| 321–800px | `m` | 320px |
| > 800px or fullscreen | `xl` | 1280px |

This saves bandwidth on smaller widgets. You can override this by setting `thumbnailSize` explicitly to `"sm"`, `"m"`, or `"xl"`.

## All Configuration Options

### Connection

| Option | Default | Description |
|---|---|---|
| `serverUrl` | `""` | Synology NAS IP address or hostname |
| `port` | `5001` | Port number (5001 HTTPS / 5000 HTTP) |
| `secure` | `true` | Use HTTPS connection |
| `account` | `""` | Synology login username |
| `password` | `""` | Synology login password |

### Photo Source

| Option | Default | Description |
|---|---|---|
| `sharedSpace` | `false` | Fetch from Shared Space instead of Personal |
| `albumId` | `null` | Filter to a specific album by ID |
| `folderId` | `null` | Filter to a specific folder by ID |
| `numPhotos` | `100` | Maximum number of photos to load |

### Slideshow

| Option | Default | Description |
|---|---|---|
| `thumbnailSize` | `"auto"` | `"auto"`, `"sm"` (240px), `"m"` (320px), `"xl"` (1280px) |
| `shuffle` | `true` | Randomize photo order |
| `sortBy` | `"time"` | Sort order when shuffle is off |
| `slideshowSpeed` | `15000` | Milliseconds each photo is displayed |
| `transitionSpeed` | `2000` | Crossfade animation duration (ms) |
| `refreshInterval` | `3600000` | How often to re-fetch photos (ms) |

### Display

| Option | Default | Description |
|---|---|---|
| `backgroundSize` | `"cover"` | Image fit: `"cover"`, `"contain"`, `"fill"` |
| `showFilename` | `false` | Show filename overlay |
| `showDate` | `false` | Show date taken overlay |
| `showCounter` | `true` | Show photo counter badge |

### Sizing

| Option | Default | Description |
|---|---|---|
| `sizePreset` | `null` | `"small"`, `"medium"`, `"large"`, `"xlarge"`, `"fullscreen"` |
| `width` | `null` | Custom width in pixels (overrides preset) |
| `height` | `null` | Custom height in pixels (overrides preset) |
| `maxWidth` | `"100%"` | CSS max-width fallback |
| `maxHeight` | `"100%"` | CSS max-height fallback |

## MagicMirror² Positions Reference

When choosing `position` in your config, these are the available MagicMirror² regions:

| Position | Description |
|---|---|
| `top_bar` | Full-width bar at top |
| `top_left` | Top-left corner |
| `top_center` | Top center |
| `top_right` | Top-right corner |
| `upper_third` | Upper third of screen |
| `middle_center` | Center of screen |
| `lower_third` | Lower third of screen |
| `bottom_left` | Bottom-left corner |
| `bottom_center` | Bottom center |
| `bottom_right` | Bottom-right corner |
| `bottom_bar` | Full-width bar at bottom |
| `fullscreen_above` | Fullscreen (above other modules) |
| `fullscreen_below` | Fullscreen (behind other modules) |

## Finding Album & Folder IDs

To find your album or folder IDs, query your Synology API directly:

**List albums:**
```
https://<NAS_IP>:5001/photo/webapi/entry.cgi?api=SYNO.Foto.Browse.Album&version=1&method=list&offset=0&limit=100&_sid=<YOUR_SID>
```

**List folders:**
```
https://<NAS_IP>:5001/photo/webapi/entry.cgi?api=SYNO.Foto.Browse.Folder&version=1&method=list_parents&_sid=<YOUR_SID>
```

## Publishing / Contributing

This module is listed on the [MagicMirror² 3rd Party Modules](https://github.com/MagicMirrorOrg/MagicMirror/wiki/3rd-Party-Modules) wiki.

To install via MMPM:
```bash
mmpm install MMM-SynologyPhotos
```

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/zarif98/MMM-SynologyPhotos).

## Security Note

Your Synology credentials are stored in the MagicMirror config file. Ensure your MagicMirror instance is only accessible on your local network. Consider creating a dedicated read-only Synology user for this module.

## License

MIT — see [LICENSE](LICENSE) for details.
