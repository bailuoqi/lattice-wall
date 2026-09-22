export const officialExampleProjects = [
  {
    name: 'hello-plugin',
    kind: 'plugin-package',
    preset: 'basic',
    summary: 'The smallest complete plug-in: one command, one permission, no network.',
  },
  {
    name: 'full-trust-plugin',
    kind: 'plugin-package',
    preset: 'full-trust',
    summary: 'A sandbox command calling a subscriber-approved Node.js handler; the author owns the toolchain.',
  },
  {
    name: 'minimal-theme',
    kind: 'theme',
    preset: 'colors',
    summary: 'The smallest complete theme: light/dark tone overrides on a public base preset.',
  },
  {
    name: 'stylesheet-theme',
    kind: 'theme',
    preset: 'stylesheet',
    summary: 'Packaged CSS scoped to the workshop pack id. Needs ECHO 26.8.20.',
  },
  {
    name: 'retro-modern-ui-runtime',
    kind: 'theme',
    preset: 'runtime',
    summary: 'Sandboxed library, queue and bottom player over the UI bridge.',
  },
  {
    name: 'lyrics-cinema-scene',
    kind: 'lyrics-style',
    preset: 'cinema',
    summary: 'Cinema-stage lyrics scene that owns transport because the mini player is hidden.',
  },
  {
    name: 'visualizer-radial',
    kind: 'visualizer-preset',
    preset: 'radial',
    summary: 'Radial spectrum preset using the host bars/wave/radial styles only.',
  },
  {
    name: 'dsp-vocal',
    kind: 'dsp-preset',
    preset: 'vocal',
    summary: 'Conservative 31-band vocal EQ. Audio Core still owns the real DSP.',
  },
  {
    name: 'locale-wenyan',
    kind: 'locale-pack',
    summary: 'Literary Chinese language pack. Missing keys fall back to Simplified Chinese.',
  },
  {
    name: 'native-shell-taskbar',
    kind: 'native-shell',
    summary: 'Windows taskbar shell using native-shell protocol v1. The exe is optional while authoring.',
  },
];

export const createCustomizeGuide = (kind, preset, id) => {
  const common = `## 日常命令

\`\`\`powershell
npm run next
npm run check
npm run dev
npm run guide
\`\`\`

\`next\` 先列当前质量报告的待办（每条带修复命令），再列宿主还允许加的槽位、能力或换档。这些命令永不上传。

## 卡住了？

- \`npm run snippet\` 列出常用代码片段（标注所需权限）；编辑器里输入 \`echo-\` 前缀可直接展开同一批片段。
- \`npm run fix\` 修复预览图、minEchoVersion 和缺失的 README / CUSTOMIZE / .gitignore。
- 报错对照表：\`npm run guide -- troubleshoot\`，完整版见 SDK 包里的 TROUBLESHOOTING.md。
`;
  if (kind === 'lyrics-style') {
    return `# 自定义歌词场景

当前档：\`${preset}\`

宿主拥有全部槽位。用 \`add . --slot spectrum\` 继续加，不必重写整份 JSON。

- editorial：封面 + 歌词
- compact：一行折叠
- cinema：隐藏迷你播放条，必须有 play-toggle
- cover：大封面柱

换档：\`scaffold . --preset cinema\`

${common}`;
  }
  if (kind === 'visualizer-preset') {
    return `# 自定义可视化

当前档：\`${preset}\`

宿主样式只有 bars / wave / radial。

\`\`\`powershell
set . --style radial
add . --color #f0b35b
set . --bars 72
\`\`\`

${common}`;
  }
  if (kind === 'dsp-preset') {
    return `# 自定义 DSP

当前档：\`${preset}\`

必须保持官方 31 段。真正的 EQ 由 Audio Core 执行。

\`\`\`powershell
scaffold . --preset vocal
set . --preamp -4
\`\`\`

${common}`;
  }
  if (kind === 'locale-pack') {
    return `# 自定义语言包

当前语言码：\`lzh\`（文言文）。可改成其它非本体语言。

语言包只含 JSON 文案，不能带脚本。缺 key 时宿主回退到本体语言。不要把简体、繁体、英、日、韩写进工坊包。

\`\`\`powershell
# 编辑 content/locale.json 的 strings 表
\`\`\`

${common}`;
  }
  if (kind === 'native-shell') {
    return `# 自定义 native-shell

包 id：\`${id}\`

这是系统壳通道，不是沙箱插件。宿主按 native-shell protocol v1 拉起 \`exe --pipe <name>\`，stdio 必须 ignore。

- 改 \`content/native-shell.json\` 的 exe / renderer / config 路径和 permissions。
- 没有打包 exe 时本地 check / test 可通过。
- 官方 Steam 工坊不会拉起订阅者提供的 exe。

${common}`;
  }
  if (kind === 'plugin-package' && preset === 'full-trust') {
    return `# 自定义完整系统插件

包 id：\`${id}\`

这是订阅者确认后运行的 Node.js 通道。作者在自己的 Node 20+ 环境里开发、安装和构建依赖；ECHO 创作台不代装环境，也不托管开发工具链。

1. 沙箱入口改 \`src/plugin.js\`，只负责宿主命令和 \`echo.trusted.invoke(...)\`。
2. 完整系统逻辑改 \`src/trusted.mjs\`；需要第三方依赖时由你自己安装、构建并把合规产物纳入包中。
3. \`npm run check\` 会验证权限、入口和包清单；mock host 不执行完整系统代码。
4. 真正执行必须在 ECHO 内启用，并由订阅者确认桌面应用同等级权限。

${common}`;
  }
  if (kind !== 'theme') {
    return `# 自定义

1. 改生成的 JSON 或 \`src/plugin.js\`。
2. 插件权限用 \`add . --permission library:read\`。
3. 发布只在 ECHO 创作台。

${common}`;
  }
  return `# 自定义主题

包 id：\`${id}\`
当前层：\`${preset}\`

| 层 | 命令 | 作用 |
| --- | --- | --- |
| colors | \`--preset colors\` | 只改深浅色 |
| skin | \`--preset skin\` | 声明式外壳 |
| stylesheet | \`scaffold . --preset stylesheet\` | 整包 CSS |
| runtime | \`scaffold . --preset runtime\` | 沙箱自定义界面 |

CSS 必须写在 \`html[data-workshop-theme-pack="${id}"]\` 下。不能用 FINAL / nyanCat / darkSideMoon 当 basePreset。

${common}`;
};

export const createGitignore = () => `workshop-preview.html
workshop-item.vdf
`;
