#!/usr/bin/env node
// Local browser harness: serves the built panel from src/ with a mock `__bridge__.js` and a toolbar.
// Usage: node scripts/dev-harness.mjs [--port 4173] [--fixture playing] [--open]
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const FIXTURES = ['playing', 'paused', 'empty', 'no-lyrics', 'plain-lyrics', 'instrumental', 'ended', 'denied', 'denied-immersive', 'large', 'single', 'album-empty', 'album-denied', 'album-error'];
const DEFAULT_PORT = 4173;
const PORT_ATTEMPTS = 20;

const ROUTES = {
  '/albums.html': { path: resolve(root, 'src', 'albums.html'), type: 'text/html; charset=utf-8' },
  '/albums.js': { path: resolve(root, 'src', 'albums.js'), type: 'text/javascript; charset=utf-8' },
  '/panel.html': { path: resolve(root, 'src', 'panel.html'), type: 'text/html; charset=utf-8' },
  '/panel.css': { path: resolve(root, 'src', 'panel.css'), type: 'text/css; charset=utf-8' },
  '/panel.js': { path: resolve(root, 'src', 'panel.js'), type: 'text/javascript; charset=utf-8' },
  '/motion-probe.js': { path: resolve(root, 'scripts', 'dev-harness', 'motion-probe.js'), type: 'text/javascript; charset=utf-8' },
  '/__bridge__.js': { path: resolve(root, 'scripts', 'dev-harness', 'mock-bridge.js'), type: 'text/javascript; charset=utf-8' },
};

function parseArgs(argv) {
  const options = { port: null, fixture: 'playing', open: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--open') options.open = true;
    else if (arg === '--port') options.port = Number.parseInt(argv[++i] ?? '', 10);
    else if (arg === '--fixture') options.fixture = argv[++i] ?? options.fixture;
    else if (arg.startsWith('--port=')) options.port = Number.parseInt(arg.slice(7), 10);
    else if (arg.startsWith('--fixture=')) options.fixture = arg.slice(10);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.port !== null && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) throw new Error('--port must be 1..65535');
  if (!FIXTURES.includes(options.fixture)) throw new Error(`--fixture must be one of: ${FIXTURES.join(', ')}`);
  return options;
}

const indexHtml = (fixture) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lattice Wall · dev harness</title>
<style>
  html, body { margin: 0; height: 100%; background: #07090d; color: #dfe7f0; font: 12px/1.4 system-ui, sans-serif; overflow: hidden; }
  iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #07090d; }
  .bar { position: fixed; top: 10px; right: 10px; z-index: 10; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: min(92vw, 760px);
    padding: 6px 8px; border-radius: 10px; background: rgba(10, 14, 20, 0.82); border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(10px); }
  .bar button, .bar select { font: inherit; color: inherit; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; padding: 4px 8px; cursor: pointer; }
  .bar button:hover, .bar select:hover { background: rgba(255,255,255,0.16); }
  .bar button[aria-pressed="true"] { background: rgba(92, 200, 220, 0.35); border-color: rgba(92, 200, 220, 0.7); }
  .live { align-self: center; padding: 0 4px; color: #9fb3c8; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .overlay { position: fixed; inset: 0; z-index: 20; display: none; place-items: center; background: rgba(4, 6, 10, 0.86); cursor: pointer; font-size: 16px; }
  .overlay[data-open="true"] { display: grid; }
  .overlay small { display: block; margin-top: 8px; color: #9fb3c8; font-size: 12px; text-align: center; }
  .toast { position: fixed; left: 50%; bottom: 24px; z-index: 30; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px; background: rgba(20, 34, 52, 0.95);
    border: 1px solid rgba(255,255,255,0.14); opacity: 0; transition: opacity 0.2s; pointer-events: none; }
  .toast[data-open="true"] { opacity: 1; }
</style>
</head>
<body>
<iframe id="frame" title="Lattice Wall panel" sandbox="allow-scripts allow-same-origin"></iframe>
<div class="bar" role="toolbar" aria-label="harness controls">
  <select id="fixture" title="fixture">${FIXTURES.map((name) => `<option value="${name}">${name}</option>`).join('')}</select>
  <button id="scheme" title="colour scheme">dark</button>
  <button id="motion" title="prefers-reduced-motion" aria-pressed="false">motion</button>
  <button id="prev">prev track</button>
  <button id="toggle">play-pause</button>
  <button id="next">next track</button>
  <button id="seek">seek +30s</button>
  <button id="last-lyric">last lyric</button>
  <button id="long-title">long title</button>
  <button id="reload">reload panel</button>
  <button id="wall-mode">专辑墙</button>
  <span class="live" id="live">panel loading…</span>
</div>
<div class="overlay" id="overlay" role="button" tabindex="0">panel closed by echo.ui.closePanel()<small>click to reload the panel</small></div>
<output id="motion-audit" style="position:fixed;bottom:8px;right:8px;z-index:10;max-width:70vw;background:#101820;color:#dfe7f0;padding:4px 8px;pointer-events:none"></output>
<script src="/motion-probe.js" defer></script>
<div class="toast" id="toast" role="status"></div>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const frame = $('frame');
  const params = new URLSearchParams(location.search);
  let fixture = params.get('fixture') || ${JSON.stringify(fixture)};
  let scheme = params.get('scheme') === 'light' ? 'light' : 'dark';
  let reducedMotion = params.get('reducedMotion') === '1';
  let albumMode = params.get('wall') === 'albums';
  let longTitle = params.get('longTitle') === '1';
  let toastTimer = 0;

  const mock = () => { try { return frame.contentWindow && frame.contentWindow.__latticeMock || null; } catch { return null; } };
  const query = () => 'fixture=' + encodeURIComponent(fixture) + '&scheme=' + scheme + '&reducedMotion=' + (reducedMotion ? 1 : 0) + '&wall=' + (albumMode ? 'albums' : 'queue') + '&longTitle=' + (longTitle ? 1 : 0);
  const load = () => {
    $('overlay').dataset.open = 'false';
    frame.src = (albumMode ? '/albums.html?' : '/panel.html?') + query();
    $('wall-mode').textContent = albumMode ? '曲库墙' : '专辑墙';
    history.replaceState(null, '', '/?' + query());
  };
  const toast = (message) => {
    $('toast').textContent = message;
    $('toast').dataset.open = 'true';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').dataset.open = 'false'; }, 2600);
  };
  const clock = (seconds) => {
    const total = Math.max(0, Math.floor(seconds || 0));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  };

  $('fixture').value = fixture;
  $('scheme').textContent = scheme;
  $('motion').setAttribute('aria-pressed', String(reducedMotion));
  $('fixture').addEventListener('change', (event) => { fixture = event.target.value; load(); });
  $('scheme').addEventListener('click', () => {
    scheme = scheme === 'dark' ? 'light' : 'dark';
    $('scheme').textContent = scheme;
    history.replaceState(null, '', '/?' + query());
    const m = mock(); if (m) m.setColorScheme(scheme);
  });
  $('motion').addEventListener('click', () => {
    reducedMotion = !reducedMotion;
    $('motion').setAttribute('aria-pressed', String(reducedMotion));
    history.replaceState(null, '', '/?' + query());
    const m = mock(); if (m) m.setReducedMotion(reducedMotion);
  });
  $('prev').addEventListener('click', () => { const m = mock(); if (m) m.previous(); });
  $('next').addEventListener('click', () => { const m = mock(); if (m) m.next(); });
  $('toggle').addEventListener('click', () => { const m = mock(); if (m) m.togglePlay(); });
  $('seek').addEventListener('click', () => { const m = mock(); if (m) m.seekBy(30); });
  $('last-lyric').addEventListener('click', () => { const m = mock(); if (m) { m.pause(); m.seekTo(m.snapshot().durationSeconds - 5); } });
  $('long-title').addEventListener('click', () => { longTitle = !longTitle; load(); });
  $('reload').addEventListener('click', load);
  $('wall-mode').addEventListener('click', () => { albumMode = !albumMode; load(); });
  $('overlay').addEventListener('click', load);

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || !event.data || event.data.channel !== 'lattice-mock') return;
    if (event.data.type === 'closed') $('overlay').dataset.open = 'true';
    else if (event.data.type === 'notify') toast('notify: ' + event.data.message);
    else if (event.data.type === 'presentation') toast('presentation: ' + event.data.presentation.size + ' · ' + event.data.presentation.title);
    else if (event.data.type === 'open-panel') {
      const id = event.data.panelId;
      if (id === 'albums' && !albumMode) { albumMode = true; load(); }
      else if ((id === 'wall' || id === 'queue') && albumMode) { albumMode = false; load(); }
    }
  });

  setInterval(() => {
    const m = mock();
    if (!m) { $('live').textContent = 'panel loading…'; return; }
    const s = m.snapshot();
    $('live').textContent = s.fixture + ' · ' + s.state + ' · ' + clock(s.positionSeconds) + ' / ' + clock(s.durationSeconds)
      + (s.index >= 0 ? ' · #' + (s.index + 1) + '/' + s.count : ' · empty') + ' · ' + s.presentationSize;
  }, 250);

  load();
})();
</script>
</body>
</html>
`;

const send = (res, status, type, body) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

function createHarnessServer(defaultFixture) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      send(res, 200, 'text/html; charset=utf-8', indexHtml(defaultFixture));
      return;
    }
    const route = ROUTES[url.pathname];
    if (!route) {
      send(res, 404, 'text/plain; charset=utf-8', `not found: ${url.pathname}\nthe harness only serves /, /panel.html, /panel.css, /panel.js and /__bridge__.js`);
      return;
    }
    try {
      send(res, 200, route.type, await readFile(route.path));
    } catch {
      send(res, 404, 'text/plain; charset=utf-8', `${url.pathname} is not built yet — run \`npm run build\` (source: ${route.path})`);
    }
  });
}

function listen(server, port, fixedPort) {
  return new Promise((resolvePort, reject) => {
    let attempt = 0;
    const tryPort = (candidate) => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && !fixedPort && attempt < PORT_ATTEMPTS) {
          attempt += 1;
          tryPort(candidate + 1);
          return;
        }
        reject(error.code === 'EADDRINUSE' ? new Error(`port ${candidate} is already in use`) : error);
      });
      server.listen(candidate, '127.0.0.1', () => resolvePort(server.address().port));
    };
    tryPort(port);
  });
}

function openBrowser(url) {
  const [command, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const server = createHarnessServer(options.fixture);
  const port = await listen(server, options.port ?? DEFAULT_PORT, options.port !== null);
  const url = `http://127.0.0.1:${port}/?fixture=${options.fixture}`;
  console.log(`Lattice Wall dev harness\n  ${url}\n  fixtures: ${FIXTURES.join(', ')}\n  panel files come from src/ (run \`npm run build\` after editing source/); Ctrl+C to stop.`);
  if (options.open) openBrowser(url);
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`dev-harness: ${error.message}`);
  process.exit(1);
});
