// Fetches a short encyclopedic summary for a structure from Wikipedia
// (CC BY-SA text, attributed with a link). Works only when online.

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const wikiCache = new Map();

function wikiQueryName(name) {
  return name
    .replace(/\b(left|right)\b/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function wikiFetch(params) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const qs = new URLSearchParams({
      action: 'query', format: 'json', origin: '*', redirects: '1',
      prop: 'extracts|pageimages|pageprops|info', inprop: 'url',
      exintro: '1', explaintext: '1', exsentences: '4', pithumbsize: '360', ...params,
    });
    const res = await fetch(`${WIKI_API}?${qs}`, { signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const pages = Object.values((data.query && data.query.pages) || {});
    return pages.find(p => !p.missing && !(p.pageprops && 'disambiguation' in p.pageprops) && p.extract) || null;
  } finally {
    clearTimeout(timer);
  }
}

async function wikiSummary(name) {
  const q = wikiQueryName(name);
  if (!q) return null;
  if (wikiCache.has(q)) return wikiCache.get(q);
  const job = (async () => {
    let page = await wikiFetch({ titles: q });
    if (!page) page = await wikiFetch({ generator: 'search', gsrlimit: '1', gsrsearch: `${q} anatomy` });
    if (!page) return null;
    return { title: page.title, extract: page.extract, url: page.fullurl, thumb: page.thumbnail && page.thumbnail.source };
  })();
  wikiCache.set(q, job);
  job.catch(() => wikiCache.delete(q));
  return job;
}
