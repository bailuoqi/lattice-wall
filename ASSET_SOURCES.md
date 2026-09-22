# Asset sources

## Design inspiration

- Project: folia-major — https://github.com/chthollyphile/folia-major
- License: AGPL-3.0
- Relationship: inspiration only. Lattice Wall reimplements the idea of an
  infinite album wall with in-place expansion from scratch. No source code,
  block templates, reflow ("yield") tables, CSS values or media were copied.
  The five block templates in `source/panel/geometry/blockTemplates.ts` are
  original designs, and `blockReflows.json` is produced by this project's own
  solver (`scripts/generate-reflows.mjs`).

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
