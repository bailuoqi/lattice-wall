/// <reference path="../.echo-sdk/echo-workshop-plugin.d.ts" />
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
