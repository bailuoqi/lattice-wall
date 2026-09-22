# Lattice · 音乐拼贴墙 (Lattice Music Wall)

English · [简体中文](./README.zh-CN.md)

One plug-in, two player launchers: **Lattice · 曲库拼贴墙** and
**Lattice · 专辑拼贴墙**. The id stays `echo.lattice-wall`, so existing
installations retain their settings when updated to 1.1.0.

The library wall loads up to 800 tracks from the ECHO library
(`echo.library.getTracks`) and tiles them into an endless, draggable wall of
covers. Larger libraries page by 800. It does not read the play queue.
`Ctrl + Space` opens the function panel (search, paging, wall behaviour,
lighting, poster tint, cell size, UI font, lyrics on the library wall, and
switching walls). Expanded cards show playback
controls; the playing track also shows seek and synchronized lyrics. The album
wall browses albums even when nothing is playing, with host-side search and 60
albums per page. Expand
an album to scroll continuously through its tracks, play one song or the whole album.
The expanded album footer centers previous, pause/resume and next. A separate
list-and-play icon starts the whole album; every button has a hover hint and
accessible name. There are no track-page buttons or page numbers.
Track reads use 50-item batches behind a virtual list: at most two visible
batches, one in-flight read and 50 rendered rows are retained. Scrolling back
reloads evicted batches; collapsing the album releases its list and data.
Only the current album page is retained for the wall.
Both panels use the same geometry, renderer, theme and reduced-motion support.

Single-track playback uses `queue.playTrack`; whole-album playback uses
`queue.playAlbum`, including the host collection limit and unavailable-track
filtering. The returned play count is displayed. Previous, pause/resume and next control
the current playback queue. `C` locates the playing album on the current page.
The SDK track has no album id, so current-album matching requires a unique
combination of album title, album artist and media type; ambiguous matches
stay unhighlighted. Library-change events offer a refresh without interrupting
browsing. Failed reads can be retried with Refresh.

Both panels fill the ECHO window with no host chrome or permanent toolbar.
Entering immersive mode maximizes the ECHO window by default on the updated host;
already maximized or fullscreen windows keep their current state.
Both walls use `Ctrl + Space` for the function panel. Library search is tracks;
album search is albums. `Enter` applies the current search without closing the
panel; `Esc` or clicking outside closes it.
With search closed, `Esc` collapses a card, then closes the panel. Both walls
keep a locate button.

Re-import the local package to update and approve `library:read`.

Design inspiration: the album wall of [folia-major](https://github.com/chthollyphile/folia-major)
(AGPL-3.0). This project is a clean-room rewrite — no code, template data,
reflow tables or stylesheet values were copied. See `ASSET_SOURCES.md`.

## Library wall features

- Up to 800 library tracks on one wall, tiled infinitely: drag in any
  direction, wheel / trackpad scrolling, inertia, keyboard navigation between
  cards. Libraries larger than 800 page. Tracks that share a cover are spread
  across the wall instead of sitting next to each other. `Ctrl + Space`
  opens the function panel to search and turn pages.
- 12×8 blocks built from five original templates with hashed mirroring so
  adjacent blocks never repeat; a pre-solved reflow table moves the other eleven
  cards aside when one expands to 6×6.
- Expanded card: title, artist, library badge, previous / play-pause / next;
  a play button for non-current tracks. The seek slider and time readout appear
  only on the playing track's card.
- Current track: no cover border, optional automatic follow when the track
  changes, current-and-next lyrics with per-word highlight.
- Bottom-right locate button (same as the `C` key) that fades in whenever the
  playing track's card is off screen and flies the camera back to it. Exit with
  `Esc` (collapse first, then close); the host draws no chrome in immersive mode.
- Host theme tokens (light / dark), reduced-motion behaviour, ARIA labels and a
  live region for the current lyric line.
- Settings for immersive mode, auto-follow, vignette, lights-out, poster tint
  (neutral black or an explicit custom colour and intensity), cell size, lyrics and
  translation; `L` / `V` / `T` toggle lights-out / vignette / tint from the
  keyboard and write back to the host settings.

## Privacy and host boundaries

Permissions: `playback:read`, `playback:control`, `queue:read`,
`queue:control`, `lyrics:read`, `library:read`, `fs:plugin`. No network hosts, no
`system:full`, no trusted entry, no file export. Every playback fact comes from
the host at 1 Hz and is interpolated locally; the plug-in never receives audio,
file paths. Library data is limited to sanitized, bounded pages. `echo.storage` only holds
the last camera position (< 1 KB).

## Local authoring

```powershell
npm ci
npm run reflows      # regenerate source/panel/geometry/blockReflows.json
npm test             # typecheck, node:test suites, build, purity gate, SDK fixtures
npm run check        # build + sync content/ + SDK quality gate
npm run dev          # local browser harness with a mock host (see below)
```

`npm run build` bundles `source/panel/main.ts` and `source/panel/albums/main.ts` into
`src/panel.js` and `src/albums.js` (IIFE,
minified) and concatenates `source/styles/*.css` into `src/panel.css`. `sync`
packages `src/` into `content/community.echo` and refreshes hashes in
`content/echo.workshop.json`.

The Workshop SDK's own `dev` command does not render plug-in panels, so
`npm run dev` starts `scripts/dev-harness.mjs`: a local server that serves the
built panel with a fake `echo` host (`scripts/dev-harness/mock-bridge.js`).
Fixtures are selected with `?fixture=`: `playing`, `paused`, `empty`,
`no-lyrics`, `plain-lyrics`, `instrumental`, `ended`, `denied`,
`denied-immersive`, `large`, `single`, `album-empty`, `album-denied`,
`album-error`. Select the wall in the harness toolbar, or open `/albums.html`.

Real-app check: ECHO → Workshop → 已安装 → import this folder (or `content/`) as
a local package → 使用 → confirm the permission list → open the collage-wall
icon on the main player bar. Re-import after each change.

## Workshop SDK baseline

This repository vendors the ECHO Workshop SDK under `.echo-sdk/` (tracked in git) so the gate
runs without a separate SDK checkout. The vendored snapshot is SDK `1.15.0` **plus a batch of
changes that are not in the public SDK release yet** — it is not the same tree as the public
`main` branch. Comparing the 42 vendored files against the public SDK:

- 17 files are identical
- 20 files differ, including `bin/echo-workshop-sdk.mjs`, `contracts/plugin-api.json`,
  `contracts/native-shell.json`, `lib/mock-host.mjs`, `lib/quality-report.mjs`,
  `lib/theme-assets.mjs` and the manifest / stylesheet schemas
- 5 files do not exist in the public SDK at all: `echo-workshop-animation-library.d.ts`,
  `lib/animation-preview.mjs`, `lib/trusted-plugin.mjs`, `schemas/animation-library.schema.json`
  and `sdk-version.json`

Two of the changed contracts are what this plug-in actually relies on:

- `echo.ui.openPanel(panelId?)`, so the background runtime can open a declared panel.
- the `immersive` panel size; older hosts reject it with `invalid-payload` and the plug-in falls
  back to `full` (`source/panel/host/bridge.ts`, `IMMERSIVE_SIZE`).

The remaining differences (native-shell contracts, the animation library, trusted plug-ins, the
offline audio session surface) belong to the SDK; they are carried along because the vendored
copy is taken as a whole. All of it is MIT-licensed SDK material, and none of it is ECHO host
application code.

`npm run check` and `npm test` use the vendored copy, so both stay green without a public
release. When the SDK ships these changes, refresh the vendored copy from the released package
and re-run the gate:

```powershell
node <released-sdk>/bin/echo-workshop-sdk.mjs upgrade .
npm run check
```

`upgrade` copies the SDK that is running it into `.echo-sdk/` and records the version in
`.echo-sdk/sdk-version.json`. That file currently reads `1.15.0`, the same as the public release,
so the version number alone does not tell the two trees apart — compare against a fresh public
checkout instead.

## Layout

```text
source/panel/        TypeScript sources (not packaged)
  main.ts            boot state machine: booting → ready | empty | denied
  albums/            album browser, details, bounded page model and panel entry
  types.ts           shared module contracts
  host/              bridge, playback clock, library / queue models, settings
  geometry/          block templates, reflow table, infinite lattice
  wall/              camera, springs, pointer, keyboard, poster DOM, controls
  lyrics/            timeline model and word-highlight view
source/styles/       stylesheets concatenated in filename order
scripts/             reflow solver, node:test suites, purity gate, dev harness
src/                 packaged sandbox files (plugin.js, panel.html, built css/js)
content/             generated Workshop item (echo.workshop.json + community.echo)
```

Host contract details live in the Workshop SDK declarations under `.echo-sdk/`.
