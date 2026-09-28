/// <reference path="../.echo-sdk/echo-workshop-plugin.d.ts" />
/*! Lattice Wall | Copyright (c) 2026 Lattice Wall contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See LICENSE and NOTICE.md in the Workshop item for license and source information.
 */
'use strict';

// Lattice Wall lives entirely in its panel. The background runtime only exposes a
// command so the plug-in dock and command palette have a visible entry point.
echo.commands.register('open-lattice', { title: 'Lattice · 音乐拼贴墙' }, async function () {
  const opened = echo.ui.openPanel();
  opened.catch(function () {
    void echo.ui.notify('当前 ECHO 还不能从播放栏打开拼贴墙，请用 Ctrl+Shift+P 从插件坞打开。');
  });
  return null;
});
