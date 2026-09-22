export const guideTopics = [
  'init',
  'add',
  'set',
  'scaffold',
  'theme',
  'lyrics',
  'visualizer',
  'dsp',
  'plugin',
  'native-shell',
  'types',
  'catalog',
  'lyrics-source',
  'snippets',
  'troubleshoot',
  'checklist',
  'publish',
];

const pages = {
  init: `init / new — 少写参数也能开工

  node .\\bin\\echo-workshop-sdk.mjs init .\\harbor --kind theme
  node .\\bin\\echo-workshop-sdk.mjs init .\\cinema --recipe cinema-lyrics

目录名会变成 id / 标题，权利人默认 Workshop Author。
想按效果挑模板：echo-workshop-sdk recipes
`,
  add: `add — 在宿主白名单里继续加东西，不用重写 JSON

  add . --slot spectrum
  add . --capability playback:control
  add . --color #f0b35b
  add . --permission library:read

歌词槽、UI capability、频谱颜色、插件权限都只能加宿主已经有的。
下一步还能加什么：echo-workshop-sdk next .
`,
  set: `set — 改常见字段

  set . --title "Harbor Night"
  set . --style wave
  set . --background cover-blur
  set . --preamp -4
  set . --bars 72
`,
  scaffold: `scaffold — 换档，不必重开项目

主题是往上叠层：colors -> skin -> stylesheet -> runtime
歌词 / 可视化 / DSP 是换起步外形，保留 id 和标题。

  scaffold . --preset stylesheet
  scaffold . --preset cinema
  scaffold . --preset radial
`,
  theme: `主题四层

  colors      只改深浅色
  skin        声明式外壳
  stylesheet  整包 CSS，必须写在 html[data-workshop-theme-pack="<id>"]
  runtime     沙箱自定义界面，宿主留紧急退出。可申请曲库浏览、歌词、频谱、随机/循环和主题本地存储。init 会带上宿主配色，state 会带当前歌词行和曲库 revision。

不能把 FINAL / nyanCat / darkSideMoon 当 basePreset。
stylesheet 和 runtime 需要 minEchoVersion 26.8.20。
`,
  lyrics: `歌词场景

宿主拥有所有槽位。你只摆位置和白名单样式。
可用槽：cover title artist album lyrics current-line previous-line next-line
         translation progress seek-bar time-current time-duration spectrum
         status track-tech play-toggle previous-track next-track volume-slider
         shuffle-toggle repeat-cycle like-toggle

隐藏迷你播放条时必须有 play-toggle。
`,
  visualizer: `可视化

宿主样式只有 bars / wave / radial，没有 particles。
调色板 1-8 个不重复 #rrggbb，barCount 8-128。
真正的频谱仍由 Audio Core 提供，dev 页只是夹具。
`,
  dsp: `DSP / EQ

必须是官方 31 段频率。增益 -12..12，Q 0.1..12，preamp -12..6。
JSON 只是预设；播放时仍由 native host / Audio Core 执行。
`,
  plugin: `开放插件

basic 只有一条命令。complete 带面板、Agent、提供器。catalog 是作者自有直链目录。lyrics 是歌词源加当前歌词面板。full-trust 是订阅者确认后运行的 Node.js 独立进程。
普通能力必须写在宿主能力表里；network:request 还要在外层清单声明 networkHosts。
需要完整文件、网络、子进程或 Node 能力时：

  init .\my-tool --recipe full-trust-plugin

作者自行安装 Node 20+、编译器和第三方依赖；创作台不代装环境。旧项目可用 add . --permission system:full 自动配对 .mjs trustedEntry。
本地 test/dev 不是生产运行时验收。
`,
  'native-shell': `native-shell — 系统壳通道

第八种工坊内容。不是沙箱 JS，是独立 Windows 进程。

  init .\\band --kind native-shell
  init .\\band --recipe native-shell-taskbar

协议 v1：宿主 spawn \`exe --pipe <name>\`，JSON Lines。
主机 → 进程：config / status / quit
进程 → 宿主：ready / log / command
命令：focusEcho toggle play pause next previous seekRatio openLyrics

权限只声明不拦截：process:spawn ipc:named-pipe shell:taskbar cover:original window:focus playback:read playback:control lyrics:read

限额与插件拆开：512 文件、单文件 256 MiB、整包 512 MiB。便携 check 允许 .exe / .dll；官方 Steam 校验仍拒绝可执行文件，也不会拉起订阅者提供的宿主。
没有打包 exe 时 check/test 可通过；真跑需要二进制。
参考实现：ECHO AudioBand。
`,
  types: `公开 TypeScript 类型

插件项目会自动引用 .echo-sdk/echo-workshop-plugin.d.ts。
echo.library / echo.queue / echo.sources / echo.playback 返回的清理后结构都有 API 2 类型，不需要导入 ECHO 本体源码。

  echo-workshop-sdk api echo.queue.moveItem
  echo-workshop-sdk api errors

contracts/plugin-api.json 是生产宿主使用的权限契约。用户拒绝类错误不能自动重试；限流和只读超时才可退避重试。
编辑声明后仍应运行 npm run check；SDK 自身会用 strict TypeScript fixture 验证公开声明。
`,
  catalog: `作者自有音源目录

ECHO 不内置网易云 / Spotify / YouTube 等流媒体。作者可以用 sources:provide 自定义目录，再用 sources:direct 把用户确认过的 HTTP(S) 直链交给 Audio Core。

  init .\\harbor --recipe source-catalog
  add . --permission network:request

search / browse / listCollection 只返回条目；resolve 只能返回一条直链。禁止 Cookie、平台页面解析和自定义播放后端。
networkHosts 只能写纯域名或公网 IPv4，不能带协议、端口、通配符、私网或本机地址。mock 会拒绝代码里未声明的目标；请求和上传优先使用 HTTPS。
`,
  'lyrics-source': `歌词插件

  init .\\harbor --recipe lyrics-source

lyrics:provide 只向宿主歌词选择器提供候选。lyrics:read 读取当前曲的清理后歌词文本，不含路径或平台账号。
真正的歌词保存、挑选和播放同步仍由 ECHO 拥有。
`,
  snippets: `snippets — 常用代码片段

  echo-workshop-sdk snippet list
  echo-workshop-sdk snippet plugin-command
  echo-workshop-sdk snippet ui-runtime-init

每段片段都标注需要的权限 / capability 和该贴到哪个文件。
init 生成的项目还带 .vscode/echo-workshop.code-snippets，
在 VS Code 里输入 echo- 前缀即可展开同一批片段。
`,
  troubleshoot: `排错速查（详见 TROUBLESHOOTING.md）

  Manifest hash mismatch        改了 content/ 或 src/ 之后先跑 sync（check 会自动做）
  capability-denied:<权限>      插件用了没声明的权限：add . --permission <权限>
  network-host-denied           代码请求了 networkHosts 未声明的域名，去外层清单声明
  network-port-denied           mock 与生产都拒绝自定义端口，改用默认 443/80
  Preview must be ...           fix . 会生成合规 256x256 preview.png
  tags warning                  只用宿主已配置的 Steam 标签（kinds 可查每类默认标签）
  Port 41783 was busy           dev 会自动顺延端口；显式 --port 被占用才会直接报错
  Target directory must be empty  init/example 需要全新空目录

先跑 npm run check 看门禁摘要；quality 的 warning 是作者决策，blocker 必须清零。
`,
  checklist: `从 0 到发布 checklist

  1  init .\\my-item --kind <kind>（或 --recipe 按效果挑）
  2  编辑 content/ 下的 JSON（插件改 src/plugin.js）
  3  npm run next        看宿主还允许加什么、当前项目缺什么
  4  npm run check       门禁必须 PASS；warning 自行判断
  5  npm run dev         在本地控制台和预览里过一遍
  6  换掉 preview.png 占位图，写好 README 和列表描述（≥80 字符）
  7  确认 license、tags、minEchoVersion 与实际测试版本一致
  8  打开 ECHO → 工坊 → 创作，校验后发布（本 SDK 永不上传）
`,
  publish: `发布

这些命令永远不会上传。
打开 ECHO → 工坊 → 创作，校验通过后再发布。
公开 Steam 起步包是 3784997717，当前已发布 1.12.0；本源码树是 1.15.0 待发布候选。以 GitHub Releases 和 Steam 条目实际资产为准。以后更新 Steam 项必须继续用这一项，不要新建。
`,
};

export const formatGuideTopics = () => [
  'ECHO Workshop SDK guide 主题（guide <topic> 查看单页）',
  ...guideTopics.map((name) => `  ${name.padEnd(14)} ${pages[name].trim().split('\n')[0]}`),
].join('\n');

export const formatGuide = (topic) => {
  if (!topic) {
    return [
      'ECHO Workshop SDK 用法（这些命令永不上传）',
      '',
      ...guideTopics.map((name) => pages[name].trim()),
    ].join('\n\n');
  }
  const page = pages[topic];
  if (!page) {
    throw new Error(`Unknown guide topic ${topic}. Use: ${guideTopics.join(', ')}`);
  }
  return page.trim();
};
