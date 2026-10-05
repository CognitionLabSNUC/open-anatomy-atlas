# Publishing Open Anatomy Atlas

This covers the online version (GitHub Pages), lab branding and releases.

## 1. Lab branding

Already set for the Cognition Lab in `src/renderer/brand.js` (name, description, website, email) and `src/renderer/brand/logo.png`. To change them, edit those two files; nothing else needs to change. The source-code link fills itself in when the site runs on GitHub Pages.

The lab appears in three places: the **About** button in the top bar, "Made by Cognition Lab" in the status bar (it opens the same page), and the README.

## 2. The online version (GitHub Pages)

Anyone can open the atlas in a browser at `https://CognitionLabSNUC.github.io/open-anatomy-atlas/`, with nothing to install.

The anatomy data (about 200 MB per atlas) is too large to keep in git. The workflow `.github/workflows/pages.yml` therefore downloads and builds the atlases on GitHub's servers, splits each mesh file into parts under 100 MB, and publishes the result together with the app.

**Turn it on once:**

1. Push the repository to GitHub.
2. Go to **Settings > Pages > Build and deployment** and set **Source** to **GitHub Actions**.
3. Go to **Actions > Deploy to GitHub Pages > Run workflow** (afterwards it runs on every push to `main` and on every release).

The first run takes 20-40 minutes because the BodyParts3D 4.3 download is slow. Downloads are cached, so later runs take a few minutes.

**Which atlases are published:** BodyParts3D 4.3 (shown first) and Z-Anatomy, built *commercial-safe* (CC BY-SA 4.0) so the public site contains no non-commercial models. To change this, add repository variables under **Settings > Secrets and variables > Actions > Variables**:

| Variable | Example | Meaning |
| --- | --- | --- |
| `SITE_ATLASES` | `bp3d43,zanatomy,bp3d40` | Atlases to publish |
| `SITE_DEFAULT` | `zanatomy` | Atlas shown first |

**Limits to keep in mind:** GitHub Pages sites should stay under 1 GB (two atlases are about 430 MB) and have a soft bandwidth limit of 100 GB per month. Each visitor downloads about 200 MB the first time they open an atlas; browsers cache it after that. For heavy classroom use, a university web server is a good alternative: copy the built `site/` folder there.

**Build the same site on your own computer:**

```bash
npm run fetch-data:43
node tools/fetch-data.js --source zanatomy --commercial-safe
npm run build-site -- --atlases bp3d43,zanatomy
cd site && python3 -m http.server 8000     # open http://localhost:8000
```

Viewers can link straight to an atlas: `.../open-anatomy-atlas/#atlas=zanatomy`.

## 3. Releases

The workflow `.github/workflows/release.yml` builds the Linux installers (`.deb` and AppImage) and attaches them to a **draft** GitHub release whenever you push a version tag:

```bash
git tag v0.0.1
git push origin v0.0.1
```

Then open **Releases**, check the draft (the notes come from `.github/RELEASE_NOTES.md` plus the commit list), and click **Publish release**. Publishing also redeploys the online version.

For the next version, update `version` in `package.json` and `src/renderer/brand.js`, add a section to `CHANGELOG.md`, then tag `v0.0.2`.

## 4. Licences on a public site

- BodyParts3D (CC BY 4.0): free to publish with attribution, which the app shows.
- Z-Anatomy: the commercial-safe build is CC BY-SA 4.0. If you publish the full build (with the inner ear and kidney models), the site must be non-commercial (CC BY-NC-SA 4.0).
- The app code is MIT. See `NOTICE.md` for every attribution.
