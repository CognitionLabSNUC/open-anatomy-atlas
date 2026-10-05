#!/usr/bin/env node
'use strict';
// Fills in the GitHub owner (user or organisation) and repository name in the docs.
//   npm run set-github -- <owner> [repo]
const fs = require('fs');
const path = require('path');
const [owner, repo = 'open-anatomy-atlas'] = process.argv.slice(2);
if (!owner || !/^[\w.-]+$/.test(owner)) { console.error('Usage: npm run set-github -- <github-user-or-org> [repo-name]'); process.exit(2); }
const root = path.join(__dirname, '..');
const files = ['README.md', 'SETUP.md', 'DEPLOY.md', 'CITATION.cff', '.github/RELEASE_NOTES.md'];
for (const f of files) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  s = s.replace(/^# repository-code: "https:\/\/github\.com\/<your-lab>\/open-anatomy-atlas".*$/m, `repository-code: "https://github.com/${owner}/${repo}"`);
  s = s.replace(/&lt;your-lab&gt;/g, owner).replace(/<your-lab>/g, owner).replace(/<owner>/g, owner);
  s = s.replace(/github\.com\/([\w.-]+)\/open-anatomy-atlas/g, `github.com/$1/${repo}`).replace(/\.github\.io\/open-anatomy-atlas/g, `.github.io/${repo}`);
  if (s !== before) { fs.writeFileSync(p, s); console.log('updated', f); }
}
console.log(`Online version will be: https://${owner}.github.io/${repo}/`);
