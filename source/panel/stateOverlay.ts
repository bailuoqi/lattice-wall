import type { RequiredCapability } from './types.ts';

export type StateOverlay = {
  show(state: 'booting' | 'ready' | 'empty' | 'denied', detail?: { missing?: RequiredCapability[] }): void;
  /** Small persistent chip at the bottom (e.g. the 500-item truncation hint); null hides it. */
  setNotice(text: string | null): void;
};

const CAPABILITY_LABELS: Record<RequiredCapability, string> = {
  'library:read': '读取曲库',
  'playback:read': '读取播放状态',
  'playback:control': '控制播放',
  'queue:read': '读取播放队列',
  'queue:control': '播放歌曲',
  'lyrics:read': '读取歌词',
  'fs:plugin': '保存插件设置',
};

const message = (title: string, body: string): [HTMLElement, HTMLElement] => {
  const heading = document.createElement('h2');
  heading.className = 'state__title';
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.className = 'state__body';
  paragraph.textContent = body;
  return [heading, paragraph];
};

export const createStateOverlay = (container: HTMLElement, host: HTMLElement): StateOverlay => {
  let notice: HTMLElement | null = null;
  return {
    show(state, detail) {
      container.replaceChildren();
      if (state === 'ready') {
        container.hidden = true;
        return;
      }
      container.hidden = false;
      container.dataset.state = state;
      if (state === 'booting') {
        container.append(...message('正在连接 ECHO', '等待宿主返回曲库…'));
        return;
      }
      if (state === 'empty') {
        container.append(...message('曲库中还没有歌曲', '在 ECHO 中导入音乐后，按 Ctrl + Space 打开功能面板并刷新。'));
        return;
      }
      const missing = detail?.missing ?? [];
      const names = missing.length > 0
        ? missing.map((capability) => `${CAPABILITY_LABELS[capability]}（${capability}）`).join('、')
        : '与 ECHO 的连接';
      container.append(...message('拼贴墙缺少必要能力', `未批准：${names}。请在 Workshop → 已安装 中重新确认权限。`));
    },
    setNotice(text) {
      if (text === null) {
        notice?.remove();
        notice = null;
        return;
      }
      if (!notice) {
        notice = document.createElement('div');
        notice.className = 'notice';
        notice.setAttribute('role', 'note');
        host.append(notice);
      }
      notice.textContent = text;
    },
  };
};
