export const workshopRecipes = [
  {
    id: 'css-theme',
    kind: 'theme',
    preset: 'stylesheet',
    summary: '整包 CSS 换皮，选择器绑在工坊包 id 上。',
  },
  {
    id: 'custom-ui',
    kind: 'theme',
    preset: 'runtime',
    summary: '沙箱 HTML/CSS/JS 自定义界面，宿主保留紧急退出。',
  },
  {
    id: 'skin-theme',
    kind: 'theme',
    preset: 'skin',
    summary: '只改声明式外壳、舞台和氛围，不写 CSS。',
  },
  {
    id: 'cinema-lyrics',
    kind: 'lyrics-style',
    preset: 'cinema',
    summary: '影院歌词台。隐藏迷你播放条时必须自带 play-toggle。',
  },
  {
    id: 'compact-lyrics',
    kind: 'lyrics-style',
    preset: 'compact',
    summary: '一行封面加标题的紧凑歌词页。',
  },
  {
    id: 'cover-lyrics',
    kind: 'lyrics-style',
    preset: 'cover',
    summary: '大封面柱的歌词台。',
  },
  {
    id: 'radial-visualizer',
    kind: 'visualizer-preset',
    preset: 'radial',
    summary: '径向频谱。宿主只有 bars / wave / radial。',
  },
  {
    id: 'wave-visualizer',
    kind: 'visualizer-preset',
    preset: 'wave',
    summary: '波形可视化。',
  },
  {
    id: 'vocal-eq',
    kind: 'dsp-preset',
    preset: 'vocal',
    summary: '克制的 31 段人声 EQ。真正的 DSP 仍由 Audio Core 执行。',
  },
  {
    id: 'bass-eq',
    kind: 'dsp-preset',
    preset: 'bass',
    summary: '克制的 31 段低频 EQ。',
  },
  {
    id: '8bit-audio',
    kind: 'dsp-preset',
    preset: '8bit',
    summary: '宿主执行的主机风格 chiptune：方波、三角低频和 LFSR 噪声鼓。',
  },
  {
    id: 'plugin-complete',
    kind: 'plugin-package',
    preset: 'complete',
    summary: '命令、面板、Agent、提供器和可导入外观。',
  },
  {
    id: 'full-trust-plugin',
    kind: 'plugin-package',
    preset: 'full-trust',
    summary: '订阅者明确确认后，在独立进程运行作者自己的 Node.js 代码。',
  },
  {
    id: 'source-catalog',
    kind: 'plugin-package',
    preset: 'catalog',
    summary: '作者自有直链目录：浏览、合集、入队。ECHO 不内置流媒体平台。',
  },
  {
    id: 'lyrics-source',
    kind: 'plugin-package',
    preset: 'lyrics',
    summary: '歌词提供器加当前歌词面板。真正的歌词仍由宿主挑选和保存。',
  },
  {
    id: 'wenyan-locale',
    kind: 'locale-pack',
    summary: '文言文语言包。翻译只活在工坊 JSON 里，缺句回退到简体中文。',
  },
  {
    id: 'colors-theme',
    kind: 'theme',
    preset: 'colors',
    summary: '只改深浅色，不写 CSS。',
  },
  {
    id: 'editorial-lyrics',
    kind: 'lyrics-style',
    preset: 'editorial',
    summary: '封面加歌词网格的默认歌词台。',
  },
  {
    id: 'bars-visualizer',
    kind: 'visualizer-preset',
    preset: 'bars',
    summary: '镜像频谱柱。宿主只有 bars / wave / radial。',
  },
  {
    id: 'native-shell-taskbar',
    kind: 'native-shell',
    summary: 'Windows 任务栏壳。宿主拉起打包 exe，走 native-shell protocol v1。官方 Steam 不会拉起订阅者 exe。',
  },
];

export const resolveRecipe = (value) => {
  const id = String(value ?? '').trim();
  if (!id) return null;
  const recipe = workshopRecipes.find((item) => item.id === id);
  if (!recipe) {
    throw new Error(`Unknown --recipe ${id}. Use: ${workshopRecipes.map((item) => item.id).join(', ')}`);
  }
  return recipe;
};
