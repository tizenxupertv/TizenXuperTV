# TizenXuper TV

[![Platform: Tizen OS](https://img.shields.io/badge/Platform-Samsung%20Tizen%204.0--9.0%2B-blue.svg)](https://developer.samsung.com/smarttv)
[![UI: React 18](https://img.shields.io/badge/UI-React%2018%20%2B%20Vite-61dafb.svg)](https://react.dev/)
[![Engine: Samsung AVPlay](https://img.shields.io/badge/Player-Hardware%20AVPlay%20%2B%20HLS-orange.svg)](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Apps2Samsung Compatible](https://img.shields.io/badge/Apps2Samsung-Community%20Ready-purple.svg)](https://github.com/Apps2Samsung/Apps2Samsung)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Ap%C3%B3yanos-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/tizenxupertv)

> **High-performance Live TV and VOD streaming application built specifically for Samsung Smart TVs (Tizen OS 4.0 to 9.0+).**  
> Combines modern React 18 architecture, GPU-accelerated TV spatial navigation, and Samsung AVPlay native hardware decoding for seamless 4K and live stream playback.

---

## 📺 Screenshots

| Featured & Trending | Live TV Guide |
| :---: | :---: |
| ![Featured](screenshots/1_portada_destacados_1080p.png) | ![Live TV](screenshots/2_tv_en_vivo_canales_1080p.png) |

| Complete VOD Catalog | Title Details & Seasons |
| :---: | :---: |
| ![VOD Catalog](screenshots/3_catalogo_completo_1080p.png) | ![VOD Details](screenshots/4_detalle_pelicula_serie_1080p.png) |

| On-Screen Remote Keyboard | Splash & Fast Startup |
| :---: | :---: |
| ![Search Keyboard](screenshots/5_busqueda_teclado_tv_1080p.png) | ![Splash Loading](screenshots/6_pantalla_carga_loading_1080p.png) |

| User Profile & Donation | Cinema Playback |
| :---: | :---: |
| ![Profile](screenshots/7_perfil_donaciones_1080p.png) | ![Player](screenshots/8_reproduccion_pelicula_1080p.png) |

---

## ✨ Highlights & Features

- **Hardware Accelerated Playback**: Directly utilizes Samsung `webapis.avplay` hardware video pipeline with automatic fallback to HLS.js for maximum codec and audio track compatibility.
- **Full Catalog Exploration**: Seamlessly browse over 21,000+ movies, series, and anime categorized by genres, release year, country, and resolution (4K UHD / 1080p).
- **Interactive Live TV Guide**: 3-column navigation (Categories, Channel List, Live Video Preview & Info) with instant channel switching.
- **TV-Optimized Remote Keyboard**: Full QWERTY on-screen keyboard tailored for 5-way D-Pad remote navigation, instant search filtering, and history.
- **Fast Startup & IndexedDB Cache**: Local offline caching for posters, categories, and channels; parallel TripleDES decryption in a dedicated Web Worker to maintain smooth 60fps UI animations.
- **Sign-in with Telegram**: Required on first launch: the TV shows a QR code that opens the TizenXuper bot in Telegram; one tap links the TV. Only the session is stored on the server (Telegram name, TV model, app version); history and favorites stay on the TV.
- **Problem Reports**: Perfil › Diagnóstico › *Enviar reporte a soporte* sends the TV model, network type, supported formats and the last playback errors (stream hosts only, never links or tokens) to support through the Telegram bot; the answer arrives in Telegram.
- **100% Samsung Remote Friendly**: Fully responsive to Samsung Smart Remote controls (D-Pad, Select, Return/Back, Play/Pause, Channel Up/Down, Volume, and Color buttons).

---

## 📥 Installation

### Method 1: Via Apps2Samsung (Recommended)

1. Download **[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung)** for your PC (Windows, macOS, or Linux).
2. Ensure your Samsung TV and computer are connected to the **same local Wi-Fi or LAN network**.
3. Enable **Developer Mode** on your Samsung TV:
   - Go to **Apps** in Smart Hub.
   - Enter `1 2 3 4 5` on your remote.
   - Switch Developer Mode to **ON** and set your computer's local IP address as the **Host PC IP**.
   - Restart the TV (hold the Power button on the remote for 3 seconds).
4. Download `TizenXuperTV.wgt` from the [latest release](https://github.com/tizenxupertv/TizenXuperTV/releases/latest). TizenXuper TV is not in the Apps2Samsung catalog.
5. In Apps2Samsung, choose **Install a file…** (PC) or **Your own package › WGT / TPK** (Android), select the file and click **Install on** your TV. The app is signed for your TV and installed automatically.

From 1.10.0 on, the app updates itself. To move to 1.10.0 from an older version, install the new `.wgt` over the installed one (keep **Install over installed version** on in Apps2Samsung's settings to keep your data).

---

## 🎮 Remote Control Mappings

| Button | Action |
|---|---|
| **D-Pad (Arrows)** | Move focus between tiles, buttons, tabs, and keyboard keys |
| **Enter / Select** | Open highlighted title, play channel, press key |
| **Return / Back** | Close modal, close keyboard, step back in menu hierarchy, exit player |
| **Play / Pause** | Toggle playback in cinema player and live TV |
| **Ch Up / Down** | Fast previous/next channel switching in live TV |
| **Exit** | Return to Samsung Smart Hub / Home screen |

---

## 🛠️ Development & Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/)
- [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download) with Samsung TV Extension (or Apps2Samsung / `tizen` CLI)

### Build Steps

```bash
# Clone the repository
git clone https://github.com/tizenxupertv/TizenXuperTV.git
cd TizenXuperTV

# Install dependencies
npm install

# Run Vite development server
npm run dev

# Compile React production bundle
npm run build

# Package into .wgt widget file
bash tools/build-and-sign.sh
```

The compiled package will be located at `build/TizenXuperTV_<version>_signed.wgt`.

### Self-update (from 1.10.0)

TVs running 1.10.0 or newer update the app's own code by themselves: `public/js/boot.js` runs the newest update
bundle the app downloaded and verified (signed manifest, ECDSA P-256), or the installed package. Big libraries,
images, `config.xml` and `boot.js` itself stay in the package (the "shell"); changing any of them needs a new
`SHELL` in `boot.js` and a reinstall with Apps2Samsung.

```bash
# Once: the signing key (kept outside the repository, back it up)
node tools/update-key.mjs

# Once per shell, from the release build: record its files
npm run build && node tools/update-release.mjs --init-shell

# Every release: after npm run build, write the signed update files
node tools/update-release.mjs
```

Attach `build/update/update-manifest.json` and `build/update/update-bundle-<version>.json` to the GitHub release next
to the `.wgt`: the bot Worker serves them to the TVs (`/tv/update`). To try an update on a TV, build with
`XUPER_UPDATE_API=http://<Mac IP>:8098` and serve `build/update/` with `node tools/update-serve.mjs`.

---

## 🌐 Community & Beta Testing

TizenXuper TV has a three-tier Telegram community:

| Space | Purpose | Link |
|---|---|---|
| **Canal TizenXuper TV** | Official announcements and release posts | [@TizenXuperTV](https://t.me/TizenXuperTV) |
| **Comunidad / Soporte** | General user support and discussion | [@TizenXuperTVSoporte](https://t.me/TizenXuperTVSoporte) |
| **TizenXuper TV Beta** | Segmented beta testing by TV generation | [Invite link](https://t.me/+CTPQE5XuzFA3MDkx) |

### Beta Group Topics

The Beta group is a Telegram forum with dedicated topics per TV generation:

| Topic | Thread ID | Purpose |
|---|---|---|
| **Legacy** (Tizen 4.0–4.5) | 7 | Tests on Tizen 4.0–4.5 TVs (2017–2018) |
| **Mid-Gen** (Tizen 5.0–5.5) | 8 | Tests on Tizen 5.0–5.5 TVs (2019–2020) |
| **Moderno** (Tizen 6.0+) | 9 | Tests on Tizen 6.0+ TVs (2021 and later) |
| **Instalacion y Certificados** | 16 | Installation, signing, and certificate help |
| **Reporte de Fallos y Canales** | 17 | Bug reports and broken channel reports |
| **Sugerencias e Ideas** | 18 | Feature requests and improvement suggestions |
| **Anuncios y Pruebas** | 19 | Beta announcements and test builds |

### Bot Commands for Beta Members

The [@TizenXuperBot](https://t.me/TizenXuperBot) provides direct deep-links into the correct topic:

- `/mitv [model]` — classifies your TV by generation and links the matching topic  
  Example: `mitv UE55RU7400` → Mid-Gen topic
- `/beta` — full beta group info and topic directory
- `/tizen` — Tizen generation reference table (4.0 to 9.0+)

Join the beta group: `https://t.me/+CTPQE5XuzFA3MDkx`

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
