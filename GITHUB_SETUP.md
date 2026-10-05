# Putting Open Anatomy Atlas on GitHub (step by step)

When you finish you will have:

- the source code in a public repository: `https://github.com/<owner>/open-anatomy-atlas`
- the atlas online for anyone: `https://<owner>.github.io/open-anatomy-atlas/`
- a release, **v0.0.1**, with Linux installers attached

`<owner>` is the GitHub account or organisation that will own the project, for example the lab's organisation.

These commands run in your Ubuntu (WSL) terminal.

## 1. One-time tools

```bash
sudo apt update
sudo apt install -y git gh unzip
git config --global user.name  "Cognition Lab"
git config --global user.email "research.cognition@snuchennai.edu.in"
gh auth login          # choose GitHub.com, HTTPS, "Login with a web browser"
```

`gh` is GitHub's command-line tool. It handles signing in, so you don't need a password or token for `git push`.

## 2. Create the empty repository

On github.com: **+ > New repository**

- **Owner:** the lab organisation (or your account)
- **Repository name:** `open-anatomy-atlas`
- **Public:** yes. GitHub Pages is free for public repositories.
- Do **not** add a README, licence or .gitignore (the project already has them)

Click **Create repository**.

## 3. Unpack the project and fill in the GitHub name

```bash
cd ~
unzip open-anatomy-atlas.zip          # creates ~/open-anatomy-atlas
cd ~/open-anatomy-atlas
npm run set-github -- <owner>         # e.g.  npm run set-github -- cognitionlab-snuc
npm test                              # all tests should pass
```

`set-github` writes the correct repository and website links into the README, SETUP, DEPLOY and citation files.

If you already have a working `~/open-anatomy-atlas` folder (with `node_modules`), unzip into a new folder instead. The anatomy data you already downloaded lives in `~/.config/open-anatomy-atlas` and is not affected.

## 4. Push the code

```bash
git init -b main
git add .
git commit -m "Open Anatomy Atlas 0.0.1"
git remote add origin https://github.com/<owner>/open-anatomy-atlas.git
git push -u origin main
```

Nothing large is uploaded: `node_modules/`, `dist/`, `site/` and the anatomy data are excluded.

## 5. Turn on GitHub Pages

In the repository on github.com:

1. **Settings > Pages > Build and deployment > Source:** choose **GitHub Actions**.
2. **Settings > Actions > General > Workflow permissions:** choose **Read and write permissions** and click **Save** (needed for releases).
3. Open the **Actions** tab. If **Deploy to GitHub Pages** is not already running, click it, then **Run workflow > Run workflow**.

The first run takes about 20-40 minutes: GitHub's servers download BodyParts3D 4.3 and Z-Anatomy and build them. Later runs reuse the cached downloads and take a few minutes. When it turns green, the atlas is live at:

```
https://<owner>.github.io/open-anatomy-atlas/
```

Finally, click the gear next to **About** on the repository's main page, paste that address into **Website**, and add a short description and topics (`anatomy`, `education`, `3d`, `medical-education`).

## 6. Publish release v0.0.1

```bash
git tag v0.0.1
git push origin v0.0.1
```

The **Release** workflow builds the `.deb` and AppImage (about 10 minutes) and creates a **draft** release. Open **Releases**, check the text and the two attached files, and click **Publish release**.

## 7. Check that everything works

- Open the online address in Chrome, Edge or Firefox. A progress bar shows while the atlas loads (about 200 MB the first time, then cached by the browser).
- Click **About**. You should see the Cognition Lab logo, website, email and a link back to the repository.
- Click **Atlas data** to switch between BodyParts3D 4.3 and Z-Anatomy.
- Send the link to a colleague on another computer.

## Updating later

```bash
cd ~/open-anatomy-atlas
# make changes, then:
npm test
git add . && git commit -m "Describe the change" && git push
```

Every push to `main` updates the online version. For a new release, change `version` in `package.json` and `src/renderer/brand.js`, add a section to `CHANGELOG.md`, commit, then `git tag v0.0.2 && git push origin v0.0.2`.

## If something goes wrong

| Problem | Fix |
| --- | --- |
| `git push` asks for a password | Run `gh auth login` again, then `gh auth setup-git`. |
| The Pages workflow fails at "Build atlases" for BodyParts3D 4.3 | The Anatomography server may be busy or blocking GitHub's servers. The site still publishes with Z-Anatomy. Re-run the workflow later, or publish 4.0 instead: add the repository variable `SITE_ATLASES` = `bp3d40,zanatomy` (Settings > Secrets and variables > Actions > Variables). |
| "Get Pages site failed" | Step 5.1 was skipped: set Pages Source to GitHub Actions and re-run. |
| The release workflow fails with a permissions error | Step 5.2: set Workflow permissions to "Read and write". In an organisation, an owner may need to allow this under the organisation's Actions settings. |
| The page loads but shows the demo mannequin | The atlas build failed. Open the workflow run, read the "Build atlases" step, and send the log. |
