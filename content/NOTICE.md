# Lattice Wall notices

Copyright (c) 2026 Lattice Wall contributors

SPDX-License-Identifier: AGPL-3.0-only

Lattice Wall is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, version 3 only.

Lattice Wall is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See the accompanying `LICENSE` for the full terms.

## Source and build instructions

Source repository: https://github.com/bailuoqi/lattice-wall

The corresponding source for this Workshop release is also included in
`SOURCE.json`. Each entry records a relative file path, encoding, contents and
SHA-256. Recreate the files in an empty directory, decoding `base64` entries
as binary and writing `utf8` entries as UTF-8, then run `npm ci` and
`npm run check`. The snapshot includes the build scripts, lockfile and SDK.

The repository contains the TypeScript and CSS sources, layout data and
generator, build scripts, dependency lockfile and vendored Workshop SDK needed
to build the plug-in. See `README.md` or `README.zh-CN.md` for instructions.
When distributing a build or a modified version, provide its corresponding
source, including your changes and build instructions, as required by the
license. A link to an unrelated or unmodified upstream version is not a
substitute for that source.

## Acknowledgements and third-party components

UI refinements adapted from ECHOSteam's Lattice Wall component:
Copyright (c) 2026 Moekotori and ECHO contributors, AGPL-3.0-only.
Source: https://github.com/Moekotori/ECHOSteam
Revision: baf53012d3a04be660775cd4c4acceb7ea5ba490.
See ASSET_SOURCES.md for the adapted presentation scope and integration changes.

Theme entry, shell markup, transport, settings batching, runtime context and
playback speed control also include adaptations from lattice-wall-theme-1.0.1
corresponding source: copyright (c) 2026 Moekotori, ECHO and Lattice Wall
contributors, AGPL-3.0-only. Main panels and the desktop entry share the wall sources.
The package uses the standard ECHOSteam plug-in SDK for playback speed and desktop
control; run `npm ci` followed by `npm run check` to recreate the single plug-in package.

The album wall of folia-major (AGPL-3.0) is an acknowledged reference:
https://github.com/chthollyphile/folia-major

The vendored ECHO Workshop SDK retains its MIT license, copyright (c) 2026
Moekotori. Its license is included at `.echo-sdk/LICENSE` in the source
repository. Development dependencies esbuild (MIT) and TypeScript (Apache-2.0)
retain their own licenses; neither is included in the plug-in runtime.

See `ASSET_SOURCES.md` in the source repository for asset provenance.
