'use strict';
const os = require('os');
const path = require('path');

// Same location the desktop app uses (Electron appData + "open-anatomy-atlas").
function defaultDataDir() {
  if (process.env.ANATOMY_DATA_DIR) return process.env.ANATOMY_DATA_DIR;
  const home = os.homedir();
  const base = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA || path.join(home, 'AppData', 'Roaming'))
    : (process.env.XDG_CONFIG_HOME || path.join(home, '.config'));
  return path.join(base, 'open-anatomy-atlas', 'dataset');
}

module.exports = { defaultDataDir };
