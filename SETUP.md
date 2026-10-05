# Setting up Open Anatomy Atlas

Just want to use it? Open the online version (link in the README) or install a `.deb` / AppImage from the Releases page. This guide is for running it from the source code.

This guide takes you from a fresh clone to a running atlas. Pick **browser mode** (simplest, and works on WSL) or the **desktop app**.

![The atlas running in a browser](docs/screenshots/setup-browser-running.png)

## 1. Requirements

| | Minimum |
| --- | --- |
| OS | Linux (Ubuntu 22.04+ / Debian 12+ tested), Windows 11 with WSL2, macOS for browser mode |
| Node.js | 18 or newer (`node -v`). 20 LTS or later is recommended |
| Disk | About 600 MB (the downloads plus the built atlas) |
| Graphics | Any GPU or browser with WebGL2 (all current Chrome, Edge and Firefox) |
| Internet | Needed once, to download the atlas |

To install Node on Ubuntu or Debian:

```bash
sudo apt update
sudo apt install -y nodejs npm git
node -v      # if it is older than 18, install a newer one from https://nodejs.org or NodeSource
```

## 2. Get the code

```bash
git clone https://github.com/CognitionLabSNUC/open-anatomy-atlas.git
cd open-anatomy-atlas
```

If you are on WSL, clone into your Linux home folder (`~/`), not `/mnt/c/...`, because it is much faster.

## 3. Download the anatomy data

Pick one or more atlases. Each is downloaded once and then works offline.

```bash
npm run fetch-data:43          # BodyParts3D 4.3, full resolution (recommended), 10-30 minutes
npm run fetch-data:zanatomy    # Z-Anatomy: both sides, ligaments, Latin names, definitions (about 21 MB)
npm run fetch-data             # BodyParts3D 4.0, simplified, the quickest (about 200 MB)
npm run fetch-data:core        # BodyParts3D 4.0 regional set only (about 62 MB)
```

Everything is built into `~/.config/open-anatomy-atlas/dataset`. When each command finishes you will see a line like:

```
Done: 3210 meshes, ... named structures, ... triangles.
The app now shows: bp3d43
```

The last atlas you install is the one that is shown. To see what is installed, or switch, run:

```bash
npm run atlases                                   # list installed atlases (* = shown)
node tools/fetch-data.js --use zanatomy           # switch (or use Atlas data in the app)
```

Useful options (put them after `--`, for example `npm run fetch-data -- --no-mirror`):

| Option | What it does |
| --- | --- |
| `--no-mirror` | Do not add mirrored copies of one-sided muscles |
| `--commercial-safe` | Z-Anatomy: leave out the non-commercial inner ear and kidney models, making the atlas CC BY-SA 4.0 |
| `--rebuild <bp3d40\|bp3d43\|zanatomy>` | Rebuild from files already downloaded (fast; use after updating the app) |
| `--dir <folder>` | Use a different data folder |

**Upgrading from an earlier version:** your existing BodyParts3D 4.0 atlas is moved into the new layout automatically. To add the mirrored left-side muscles to it, run `npm run fetch-data -- --rebuild bp3d40`.

## 4a. Run in a browser (recommended, no extra installs)

```bash
npm run web
```

Open **http://localhost:8080**. On WSL, open that address in your Windows browser. If it does not load there, run `hostname -I` in WSL and use `http://<that-ip>:8080`.

To use a different port, run `node tools/serve.js --port 9000`.

## 4b. Run the desktop app

```bash
npm install                 # downloads Electron (about 100 MB)
npm start
```

On **Ubuntu 24.04** (including WSL), if the app exits with a "SUID sandbox helper" error, run `npm run start:nosandbox` instead, or install the `.deb` package below.

On **WSL**, desktop windows need Windows 11 (WSLg), and you also need these libraries:

```bash
sudo apt install -y libnss3 libgtk-3-0t64 libgbm1 libasound2t64 libxss1 libxshmfence1
```

If you start the desktop app without any data, it opens **Atlas data**, where you can download any of the three atlases.


## 5. Build installable packages (optional)

```bash
npm install
npm run dist
```

The output goes to `dist/`:

- `open-anatomy-atlas-<version>-amd64.deb`: install it with `sudo apt install ./dist/open-anatomy-atlas-*-amd64.deb`, then open it from the app menu (Education).
- `open-anatomy-atlas-<version>-x86_64.AppImage`: make it executable with `chmod +x`, then run it. It needs `libfuse2` (`libfuse2t64` on Ubuntu 24.04). Add `--no-sandbox` if you see the sandbox error.

## 6. Check everything works

```bash
npm test
```

All tests should pass. They need no internet and no Electron.

## Offline or blocked downloads

Downloads resume where they stopped. Run the same command again and finished files or batches are kept.

**BodyParts3D 4.0:** if `dbarchive.biosciencedbc.jp` is unreachable, download the six `.txt` lists and `partof_BP3D_4.0_obj_99.zip` (and optionally `isa_BP3D_4.0_obj_99.zip`) from the [BodyParts3D download page](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html), then run:

```bash
node tools/fetch-data.js --import ~/Downloads/*.zip ~/Downloads/*.txt
```

**BodyParts3D 4.3:** if the Anatomography server refuses the batch downloads, the full 4.3 mesh set is mirrored in the [body_parts_3d_api](https://github.com/olivercase/body_parts_3d_api) repository (it uses Git LFS):

```bash
sudo apt install git-lfs
git clone https://github.com/olivercase/body_parts_3d_api ~/bp3d43
cd ~/bp3d43 && git lfs pull
cd ~/open-anatomy-atlas
node tools/fetch-data.js --import ~/bp3d43
```

**Z-Anatomy:** files come from `raw.githubusercontent.com` (the `nqwrc/3d-anatomy` repository, pinned to a fixed commit). If GitHub is blocked, download that repository's `public/models`, `public/data` and `public/draco` folders and place them in `~/.config/open-anatomy-atlas/dataset/atlases/zanatomy/raw/` as `models/`, `data/` and `draco/`. Rename `draco/draco_decoder.js` to `draco/draco_decoder.cjs`, then run `node tools/fetch-data.js --rebuild zanatomy`.

## Where things are stored

| What | Where |
| --- | --- |
| Downloads for each atlas | `~/.config/open-anatomy-atlas/dataset/atlases/<source>/raw/` |
| Built atlas (`index.json`, `meshes.bin`) | `~/.config/open-anatomy-atlas/dataset/atlases/<source>/build/` |
| Which atlas is shown | `~/.config/open-anatomy-atlas/dataset/active.json` |
| Use a different folder | set `ANATOMY_DATA_DIR=/path` before any command |

To remove one atlas, delete its folder under `atlases/`, or use **Remove** in the app's **Atlas data**. To remove everything, delete `~/.config/open-anatomy-atlas/dataset`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `fetch is not defined` | Your Node is older than 18. Upgrade Node. |
| Blank grey view, "does not support WebGL2" | Turn on hardware acceleration in your browser settings, or update your graphics driver. |
| Page shows the "Demo mannequin" | No atlas found. Run `npm run fetch-data:43` (or another source), then reload. |
| The view is slow or jerky | The full-resolution atlases are large. Try BodyParts3D 4.0 (`npm run fetch-data`), and close other GPU-heavy tabs. |
| BodyParts3D 4.3 download fails part way | Run `npm run fetch-data:43` again to resume, or use the Git LFS route above. |
| `--use` says the atlas is not installed | Run `npm run atlases` to see what is installed. |
| Download stops part way | Run the command again. Finished files are skipped. Or use the offline import above. |
| Sandbox error on Ubuntu 24.04 | Run `npm run start:nosandbox`, or install the `.deb`. |
| WSL: localhost does not open in Windows | Use the IP from `hostname -I`. |
