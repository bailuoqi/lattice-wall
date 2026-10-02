import { startLatticeLibraryWall } from './main.ts';
import { startLatticeAlbumWall } from './albums/main.ts';
import { createPluginWallApi } from './host/pluginApi.ts';
import { wallShell } from './wallShell.ts';

const host = document.querySelector<HTMLElement>('.lattice-wall-host')!;
const api = createPluginWallApi(echo);
let current: 'library' | 'albums' | null = null;
let abort: AbortController | null = null;
let stop: (() => void) | null = null;
let disposed = false;
async function mount(context: EchoWorkshopUiContext): Promise<void> {
  if (disposed) return;
  const mode = context.panel?.id === 'albums' ? 'albums' : 'library';
  document.body.dataset.desktopWall = String(Boolean(context.desktop));
  document.body.style.setProperty('--desktop-wall-bottom-inset', String(context.desktop?.bottomInset ?? 0) + 'px');
  if (mode === current) return;
  current = mode; abort?.abort(); stop?.(); stop = null;
  const scope = new AbortController(); abort = scope;
  document.body.dataset.state = 'booting';
  const root = document.createElement('div'); root.className = 'lattice-wall';
  root.innerHTML = mode === 'albums' ? wallShell('专辑拼贴墙', '定位到正在播放的专辑') : wallShell('曲库拼贴墙', '定位到正在播放的歌曲');
  host.replaceChildren(root);
  try {
    const cleanup = await (mode === 'albums' ? startLatticeAlbumWall : startLatticeLibraryWall)(api, scope.signal);
    if (disposed || scope.signal.aborted) cleanup();
    else { stop = cleanup; parent.postMessage({ channel: 'echo:workshop-plugin', version: 1, type: 'desktop-mounted' }, '*'); }
  } catch {
    if (!disposed && !scope.signal.aborted) { document.body.dataset.state = 'error'; const state = root.querySelector<HTMLElement>('#state');
      if (state) { state.hidden = false; state.textContent = '桌面拼贴墙加载失败，请关闭后重试。'; } }
  }
}
const off = echo.ui.onContextChanged(context => { void mount(context); });
void echo.ui.getContext().then(context => mount(context));
window.addEventListener('pagehide', () => { disposed = true; off(); abort?.abort(); stop?.(); }, { once: true });
