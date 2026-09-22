# Lattice · 音乐拼贴墙

[English](./README.md) · 简体中文

一个插件，两个播放栏入口：**Lattice · 曲库拼贴墙** 与 **Lattice · 专辑拼贴墙**。
插件 id 保持 `echo.lattice-wall`，所以从旧版本升级到 1.1.0 时已有设置不会丢失。

曲库墙从 ECHO 曲库读取最多 800 首歌曲（`echo.library.getTracks`），铺成一面可以无限拖动的封面墙；
曲库更大时按 800 首翻页。它不读取播放队列。`Ctrl + Space` 打开功能面板（搜索、翻页、墙面行为、
灯光、叠色、格子尺寸、界面字体、曲库墙歌词，以及切墙）。展开卡片会显示播放控制；
正在播放的那一首还会显示进度条与逐字歌词。

专辑墙在没有播放时也能浏览专辑，搜索由宿主完成，每页 60 张。展开专辑可以连续滚动曲目，
播放单曲或整张专辑。展开后的底部居中排列上一曲、暂停 / 继续、下一曲；另有一枚独立的列表播放图标
用于播放整张专辑。每个按钮都有悬停提示和无障碍名称，没有曲目翻页按钮或页码。
曲目按 50 首一批读取，虚拟列表下最多保留两批可见数据、一个在途请求和 50 行已渲染行；
回滚时重新读取被释放的批次，收起专辑即释放列表与数据。墙面只保留当前专辑页。

两面墙共用同一套几何、渲染器、主题与 reduced-motion 支持。

单曲播放走 `queue.playTrack`，整张专辑播放走 `queue.playAlbum`，其中包含宿主的集合上限与
不可用曲目过滤，界面显示实际播放数量。上一曲 / 暂停继续 / 下一曲控制当前播放队列。
`C` 在当前页定位正在播放的专辑。SDK 的曲目 DTO 没有专辑 id，所以当前专辑匹配要求
专辑名、专辑艺术家与媒体类型三者构成唯一组合；存在歧义时不标记。曲库变化事件提供刷新入口，
不会打断浏览。读取失败可以用「刷新」重试。

两个面板都铺满 ECHO 窗口，没有宿主外壳，也没有常驻工具栏。在较新的宿主上进入沉浸模式会
默认最大化 ECHO 窗口；已经最大化或处于操作系统全屏时保持原状态。
两面墙都用 `Ctrl + Space` 打开功能面板：曲库墙搜歌曲，专辑墙搜专辑。
`Enter` 应用当前搜索但不关闭面板；`Esc` 或点击外侧关闭。
搜索关闭后，`Esc` 先收起展开卡，再按一次关闭面板。两面墙都保留右下角定位按钮。

每次改动后要重新导入本地包，以更新并重新批准 `library:read`。

设计灵感来自 [folia-major](https://github.com/chthollyphile/folia-major) 的专辑墙（AGPL-3.0）。
本项目是干净重写 —— 没有复制任何代码、模板数据、让位表或样式数值，详见 `ASSET_SOURCES.md`。

## 曲库墙特性

- 一面墙最多铺 800 首曲库歌曲，无限平铺：任意方向拖动、滚轮 / 触控板滚动、惯性、卡片间键盘导航。
  超过 800 首则翻页。封面相同的歌曲会被打散到墙面各处，而不是相邻摆放。
  `Ctrl + Space` 打开功能面板做搜索与翻页。
- 12×8 的 block 由五套原创模板经哈希镜像构成，相邻 block 永不重复；
  预生成的让位表在某张卡展开为 6×6 时，把同一 block 内其余十一张移开。
- 展开卡：标题、艺术家、曲库标记、上一曲 / 播放暂停 / 下一曲；非当前曲另有一个播放按钮。
  进度条与时间只出现在正在播放的那张卡上。
- 当前曲：封面无描边；曲目切换时可自动跟随；显示当前与下一句歌词，并逐字高亮。
- 右下角定位按钮（等同 `C` 键）在正在播放的卡片移出视野时淡入，点击后相机飞回该卡。
  用 `Esc` 退出（先收起，再关闭）；沉浸模式下宿主不绘制任何外壳。
- 跟随宿主主题 token（浅色 / 深色）、reduced-motion 行为、ARIA 标签，以及当前歌词行的 live region。
- 可设置沉浸模式、自动跟随、暗角、关灯、叠色（中性黑，或指定颜色与强度）、格子尺寸、歌词与翻译；
  `L` / `V` / `T` 可在键盘上切换关灯 / 暗角 / 叠色，并写回宿主设置。

## 隐私与宿主边界

权限：`playback:read`、`playback:control`、`queue:read`、`queue:control`、`lyrics:read`、
`library:read`、`fs:plugin`。没有网络域名，没有 `system:full`，没有 trusted entry，没有文件导出。
所有播放事实以 1 Hz 来自宿主并在本地插值；插件从不接触音频和文件路径。
曲库数据只限于经过清理的有界分页。`echo.storage` 只保存最后一次相机位置（< 1 KB）。

## 本地开发

```powershell
npm ci
npm run reflows      # 重新生成 source/panel/geometry/blockReflows.json
npm test             # typecheck、node:test 套件、构建、纯净性门、SDK 夹具
npm run check        # 构建 + 打包 content/ + SDK 质量门
npm run dev          # 带假宿主的本地浏览器环境（见下）
```

`npm run build` 把 `source/panel/main.ts` 与 `source/panel/albums/main.ts` 分别打包成
`src/panel.js` 和 `src/albums.js`（IIFE、压缩），并按文件名顺序把 `source/styles/*.css`
拼接成 `src/panel.css`。`sync` 把 `src/` 打包进 `content/community.echo`，
并刷新 `content/echo.workshop.json` 里的哈希。

Workshop SDK 自带的 `dev` 命令不渲染插件面板，所以 `npm run dev` 启动
`scripts/dev-harness.mjs`：一个本地静态服务，用假 `echo` 宿主
（`scripts/dev-harness/mock-bridge.js`）渲染构建后的面板。
用 `?fixture=` 选择夹具：`playing`、`paused`、`empty`、`no-lyrics`、`plain-lyrics`、
`instrumental`、`ended`、`denied`、`denied-immersive`、`large`、`single`、
`album-empty`、`album-denied`、`album-error`。在工具栏切换墙面，或直接打开 `/albums.html`。

真机验证：ECHO → 创意工坊 → 已安装 → 把本目录（或 `content/`）作为本地包导入 → 使用 →
确认权限清单 → 点击主界面播放栏的拼贴墙图标。每次改动后都要重新导入。

## Workshop SDK 基线

本仓库把 ECHO Workshop SDK 以 vendored 形式放在 `.echo-sdk/`（纳入 git），
因此质量门不需要额外检出 SDK 就能运行。当前快照是 SDK `1.15.0`
**加上一批尚未进入公开 SDK 发版的改动** —— 它与公开 `main` 分支并不是同一棵树。
把 42 个 vendored 文件与公开 SDK 逐一比对：

- 17 个文件完全一致
- 20 个文件内容不同，包括 `bin/echo-workshop-sdk.mjs`、`contracts/plugin-api.json`、
  `contracts/native-shell.json`、`lib/mock-host.mjs`、`lib/quality-report.mjs`、
  `lib/theme-assets.mjs`，以及清单与样式表 schema
- 5 个文件在公开 SDK 里完全不存在：`echo-workshop-animation-library.d.ts`、
  `lib/animation-preview.mjs`、`lib/trusted-plugin.mjs`、
  `schemas/animation-library.schema.json`、`sdk-version.json`

其中只有两个契约是本插件真正依赖的：

- `echo.ui.openPanel(panelId?)`：让后台 runtime 打开已声明的面板。
- `immersive` 面板尺寸；较旧的宿主会以 `invalid-payload` 拒绝，插件回退到 `full`
  （见 `source/panel/host/bridge.ts` 的 `IMMERSIVE_SIZE`）。

其余差异（native shell 契约、动画库、trusted 插件、离线音频会话接口）属于 SDK 本身；
之所以一并带入，是因为 vendored 副本按整体取用。它们全部是 MIT 许可的 SDK 材料，
不包含任何 ECHO 宿主应用代码。

`npm run check` 与 `npm test` 都使用这份 vendored 副本，所以无需公开发版即可保持全绿。
当 SDK 正式发布这些改动后，用发布包刷新 vendored 副本并重跑质量门：

```powershell
node <released-sdk>/bin/echo-workshop-sdk.mjs upgrade .
npm run check
```

`upgrade` 会把正在运行它的那份 SDK 复制进 `.echo-sdk/`，并把版本记录到
`.echo-sdk/sdk-version.json`。注意当前 vendored 的 `sdk-version.json` 也写着 `1.15.0`，
与公开发版号相同，所以光看版本号区分不出两棵树 —— 要判断差异请与全新的公开检出对比。

## 目录结构

```text
source/panel/        TypeScript 源码（不参与打包）
  main.ts            启动状态机：booting → ready | empty | denied
  albums/            专辑浏览、详情、有界分页模型与面板入口
  types.ts           模块间共享契约
  host/              桥接、播放时钟、曲库 / 队列模型、设置
  geometry/          block 模板、让位表、无限点阵
  wall/              相机、弹簧、指针、键盘、卡片 DOM、控件
  lyrics/            时间轴模型与逐字高亮视图
source/styles/       按文件名顺序拼接的样式表
scripts/             让位表求解器、node:test 套件、纯净性门、dev harness
src/                 打包后的沙箱文件（plugin.js、panel.html、构建出的 css/js）
content/             生成的工坊条目（echo.workshop.json + community.echo）
```

宿主契约细节以 `.echo-sdk/` 下的 SDK 类型声明为准。
