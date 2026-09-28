# Asset sources

## Project license and reference

Lattice Wall is licensed under AGPL-3.0-only. See `LICENSE` and `NOTICE.md`.

- Project: folia-major — https://github.com/chthollyphile/folia-major
- License: AGPL-3.0
- Relationship: reference for the album-wall design. The previous claims of
  inspiration only, clean-room implementation, original template designs and
  no copying of code, data or stylesheet values have been withdrawn.
- Local build inputs: `source/panel/geometry/blockTemplates.ts` contains the
  five templates; `scripts/generate-reflows.mjs` generates `blockReflows.json`.

## Packaged assets

The plug-in packages no fonts, images, audio or video. Visuals come from:

- Album covers supplied by the ECHO host at runtime (`echo-cover:` URLs) and a
  procedurally generated two-colour gradient when a track has no cover.
- Icons authored as inline SVG paths inside `source/panel/wall/controls.ts`
  and `source/panel/albums/albumActions.ts`.
- A background noise texture generated as an inline SVG `feTurbulence` data URI
  in `source/styles/10-wall.css`.
- System font stack (`system-ui`, PingFang SC, Microsoft YaHei, ...).

## Workshop preview

- File: `preview.png`
- Created for Lattice Wall from a screenshot of the panel running in the local
  dev harness (`npm run dev`, fixture `playing`) with procedurally generated
  placeholder covers. It contains no third-party artwork, logo or font file.

## Third-party components

Runtime: none. Development only: `esbuild` (MIT) and `typescript`
(Apache-2.0), neither of which ships in the package.

The vendored ECHO Workshop SDK under `.echo-sdk/` comes from
https://github.com/Moekotori/echo-workshop-sdk and retains its MIT license
(copyright 2026 Moekotori); see `.echo-sdk/LICENSE`. The snapshot and its local
differences are documented in the README's Workshop SDK baseline section.
