// Who made this instance. Edit these values (and replace brand/logo.png) to rebrand.
window.BRAND = {
  lab: 'Cognition Lab',
  institution: 'Shiv Nadar University Chennai',
  about: 'Open Anatomy Atlas is developed by the Cognition Lab, Shiv Nadar University Chennai, as a free, open-source tool for teaching and learning human anatomy.',
  website: 'https://www.snuchennai.edu.in/cognitionlab/',
  email: 'research.cognition@snuchennai.edu.in',
  logo: 'brand/logo.png',
  // Leave empty to detect it automatically when served from GitHub Pages
  // (https://<owner>.github.io/<repo>/ -> https://github.com/<owner>/<repo>).
  repository: '',
  version: '0.0.1',
};
(function () {
  var B = window.BRAND;
  var m = /^([\w-]+)\.github\.io$/i.exec(location.hostname);
  if (!B.repository && m) {
    var repo = location.pathname.split('/').filter(Boolean)[0] || (m[1] + '.github.io');
    B.repository = 'https://github.com/' + m[1] + '/' + repo;
  }
})();
