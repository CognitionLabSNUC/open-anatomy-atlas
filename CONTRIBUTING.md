# Contributing

Thank you for helping make anatomy easier to teach and learn.

## Getting set up

Follow [SETUP.md](SETUP.md). For day-to-day development, browser mode is quickest:

```bash
npm run fetch-data:zanatomy   # small, quick to build
npm run web                   # http://localhost:8080, reload after changes
npm test                      # no network or Electron needed
```

## Where things live

| Area | Files |
| --- | --- |
| Data sources | `src/data/bp3d.js` (4.0), `bp3d43.js` (4.3), `zanatomy.js` |
| Shared build stages | `src/data/graph.js` (names, trees, labels), `assemble.js` (orientation, mirroring, packing) |
| Display categories | `src/data/classify.js` |
| Downloads, atlas folders | `src/data/pipeline.js`, `pipeline-download.js` |
| Viewer | `src/renderer/gl.js` (WebGL2), `app.js` (UI), `atlas.js` (queries) |
| Desktop shell | `src/main/` |

## Adding a data source

1. Write `src/data/<source>.js` with `download...()` and `build...()` functions. Build a concept map with `newConcept`/`link`, call `buildGraph`, then `assemble`.
2. Register it in `SOURCES` in `pipeline.js` and add a branch in `prepare()` and `rebuild()`.
3. Add an npm script, a row to the README comparison table, and the licence and attribution to `NOTICE.md`.
4. Add a test with a small synthetic fixture in `test/run-tests.js`.

Only use data whose licence allows educational use and redistribution of derived files, or import it from a copy the user supplies, as with ICRP data. State the licence plainly in the app.

## Style

- No runtime dependencies. Plain JavaScript, CommonJS in `src/data` and `tools`, browser scripts in `src/renderer`.
- Interface text: sentence case, plain words, and say what a button does.
- Keep `npm test` fast and offline.

## Reporting problems

Open an issue with the bug template. A screenshot and the browser console output help the most.
