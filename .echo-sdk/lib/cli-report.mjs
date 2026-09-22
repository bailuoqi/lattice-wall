import { entryFileForKind } from './content-kind-contract.mjs';

const mark = {
  pass: 'OK',
  warning: '!',
  blocker: 'X',
};

export const formatQualityReport = (report) => {
  const lines = [
    `Quality ${report.ok ? 'passed' : 'failed'}: ${report.summary.pass} pass, ${report.summary.warning} warning, ${report.summary.blocker} blocker`,
  ];
  for (const item of report.issues) {
    lines.push(`  ${mark[item.severity] ?? '?'} ${item.code}  ${item.message}`);
  }
  if (!report.ok) {
    lines.push('Hint: fix blockers, then run quality again. Warnings are author decisions.');
  }
  return lines.join('\n');
};

export const formatTestReport = (report) => {
  if (report.kind === 'plugin-package') {
    const lines = [`Test ${report.ok ? 'passed' : 'failed'} for plug-in package`];
    for (const check of report.checks ?? []) {
      lines.push(`  ${check.ok ? 'OK' : 'X'} ${check.kind}:${check.id}${check.error ? `  ${check.error}` : ''}`);
    }
    return lines.join('\n');
  }
  const lines = [`Test ${report.ok ? 'passed' : 'failed'} for ${report.kind}`];
  for (const check of report.checks ?? []) {
    lines.push(`  ${check.ok ? 'OK' : 'X'} ${check.id}${check.error ? `  ${check.error}` : ''}`);
  }
  return lines.join('\n');
};

export const formatGateSummary = (report) => [
  `[echo-workshop-sdk] Gate ${report.ok ? 'PASS' : 'FAIL'} for ${report.id}`,
  `quality ${report.gate.qualityPass} pass / ${report.gate.qualityWarnings} warning / ${report.gate.qualityBlockers} blocker`,
  `fixtures ${report.gate.fixturesPassed}/${report.gate.fixturesTotal}`,
].join(' · ');

export const formatExplain = (inspection) => {
  const lines = [
    `${inspection.title} (${inspection.id})`,
    `Kind: ${inspection.kind} · version ${inspection.version} · min ECHO ${inspection.minEchoVersion ?? 'n/a'}`,
    `Files: ${inspection.files.join(', ') || '(none)'}`,
  ];
  const customization = inspection.customization ?? {};
  if (inspection.kind === 'theme') {
    lines.push(`Theme layer: ${customization.preset}`);
    lines.push(`basePreset: ${customization.basePreset ?? 'n/a'} (must stay a public host preset, never FINAL)`);
    if (customization.stylesheet) {
      lines.push(`Stylesheet: ${customization.stylesheet} · scope CSS to html[data-workshop-theme-pack="${inspection.id}"]`);
    }
    if (customization.skin) lines.push('Skin: declarative chrome / stages / atmosphere are present.');
    if (customization.runtime) {
      lines.push(`UI runtime: ${customization.runtime.entry}`);
      lines.push(`Capabilities: ${(customization.runtime.capabilities ?? []).join(', ') || '(none)'}`);
    }
  } else if (inspection.kind === 'plugin-package') {
    lines.push(`Plug-in layer: ${customization.preset}`);
    lines.push(`Permissions: ${(customization.permissions ?? []).join(', ') || '(none)'}`);
    lines.push(`Contributions: ${(customization.contributions ?? []).join(', ') || '(none)'}`);
  } else if (inspection.kind === 'lyrics-style') {
    lines.push(`Lyrics preset: ${customization.preset}`);
    lines.push(`Host page style: ${customization.pageStyle ?? 'unset'}`);
    lines.push(`Scene background: ${customization.background ?? 'settings only'}`);
    lines.push(`Slots: ${(customization.slots ?? []).join(', ') || '(none)'}`);
    if (customization.hidesMiniPlayer) lines.push('Host mini player is hidden; play-toggle must stay in the scene.');
  } else if (inspection.kind === 'visualizer-preset') {
    lines.push(`Visualizer preset: ${customization.preset}`);
    lines.push(`Style: ${customization.style} · ${customization.barCount ?? '?'} bars · mirror ${customization.mirror}`);
    lines.push(`Palette: ${(customization.palette ?? []).join(', ') || '(none)'}`);
  } else if (inspection.kind === 'dsp-preset') {
    lines.push(`DSP preset: ${customization.preset}`);
    lines.push(`preampDb: ${customization.preampDb} · ${customization.bandCount} bands`);
  } else if (inspection.kind === 'locale-pack') {
    lines.push(`Locale: ${customization.locale} · ${customization.nativeLabel ?? customization.label ?? ''}`);
    lines.push(`Strings: ${customization.stringCount ?? 0}. Missing keys fall back to a built-in locale.`);
  } else if (inspection.kind === 'native-shell') {
    lines.push(`Protocol: v${customization.protocolVersion ?? '?'}`);
    lines.push(`Exe: ${customization.exe ?? '(none)'}`);
    lines.push(`Permissions: ${(customization.permissions ?? []).join(', ') || '(none)'}`);
  }
  lines.push('Local test/dev never uploads. Publish only from ECHO Authoring Studio.');
  return lines.join('\n');
};

export const formatKinds = (catalog) => {
  const lines = ['Workshop content kinds'];
  for (const item of catalog.kinds) {
    lines.push(`  ${item.kind.padEnd(22)} entry ${item.entry} · tag ${item.tag}${item.defaultPreset ? ` · default --preset ${item.defaultPreset}` : ''}`);
  }
  lines.push('Theme presets: ' + catalog.presets.theme.join(', '));
  lines.push('Lyrics presets: ' + catalog.presets['lyrics-style'].join(', '));
  lines.push('Visualizer presets: ' + catalog.presets['visualizer-preset'].join(', '));
  lines.push('DSP presets: ' + catalog.presets['dsp-preset'].join(', '));
  lines.push('Plugin presets: ' + catalog.presets['plugin-package'].join(', '));
  return lines.join('\n');
};

// Maps quality issue codes to the concrete command or edit that clears them,
// so next can point at what this project needs instead of a static list.
const attentionCommands = {
  'preview-readable': 'fix .  (writes a valid 256x256 preview.png)',
  'preview-size': 'fix .  (writes a valid 256x256 preview.png)',
  'preview-square': 'replace preview.png with a square image',
  description: 'edit echo.workshop.project.json description (80+ characters)',
  'change-note': 'edit echo.workshop.project.json changeNote',
  tags: 'edit echo.workshop.project.json tags (run kinds for the configured tags)',
  placeholders: 'replace the remaining template placeholder text',
  documentation: 'fix .  (creates a starter README.md), then describe setup and usage',
  'theme-stylesheet-min-echo': 'fix .  (bumps minEchoVersion for packaged stylesheets)',
  'theme-runtime-min-echo': 'fix .  (bumps minEchoVersion for UI runtimes)',
  'theme-stylesheet': 'sync .  (or fix the stylesheet path), then check .',
  'theme-runtime': 'sync .  (or fix the runtime entry path), then check .',
  'network-hosts': 'declare networkHosts in content/echo.workshop.json',
};

export const attentionFromQuality = (quality) => quality.issues
  .filter((item) => item.severity === 'warning' || item.severity === 'blocker')
  .map((item) => ({
    code: item.code,
    severity: item.severity,
    message: item.message,
    command: attentionCommands[item.code] ?? 'see the quality report message, then run check .',
  }));

export const formatNextMoves = (moves, attention = []) => {
  const attentionBlock = attention.length > 0 ? [
    'Fix first (from the current quality report):',
    ...attention.slice(0, 6).map((item) => `  ${item.severity === 'blocker' ? 'X' : '!'} ${item.code.padEnd(16)} ${item.command}`),
    ...(attention.length > 6 ? [`  … ${attention.length - 6} more. Run quality . for the complete report.`] : []),
  ].join('\n') : '';
  const movesBlock = [
    'You can keep customizing inside the host whitelist:',
    ...moves.slice(0, 12).map((move) => `  ${move}`),
    ...(moves.length > 12 ? [`  … ${moves.length - 12} more. Run with --json to see all.`] : []),
    'These commands never upload.',
  ].join('\n');
  return attentionBlock ? `${attentionBlock}\n\n${movesBlock}` : movesBlock;
};

export const formatNextSteps = (result, kind, preset) => [
  `[echo-workshop-sdk] 已创建 ${result.id}（${kind}${preset ? ` / ${preset}` : ''}）`,
  `  目录     ${result.root}`,
  `  文件     ${result.files}`,
  '  下一步   npm run next',
  '           npm run check',
  '           npm run dev',
  '           npm run guide',
  preset === 'stylesheet' ? '  编辑     content/theme.css' : '',
  preset === 'runtime' ? '  编辑     content/ui/index.html 和 content/ui/app.js' : '',
  kind === 'lyrics-style' ? `  编辑     content/${entryFileForKind('lyrics-style')}，或 add . --slot spectrum` : '',
  kind === 'visualizer-preset' ? `  编辑     content/${entryFileForKind('visualizer-preset')}，或 set . --style radial` : '',
  kind === 'dsp-preset' ? `  编辑     content/${entryFileForKind('dsp-preset')}，或 scaffold . --preset vocal` : '',
  kind === 'locale-pack' ? `  编辑     content/${entryFileForKind('locale-pack')}。缺 key 会回退到本体语言。` : '',
  kind === 'plugin-package' && preset === 'full-trust' ? '  编辑     src/plugin.js 和 src/trusted.mjs（环境由作者自管）' : '',
  kind === 'plugin-package' && preset !== 'full-trust' ? '  编辑     src/plugin.js' : '',
  kind === 'native-shell' ? '  编辑     content/native-shell.json；exe 可后补' : '',
  '  发布     只在 ECHO 创作台；这些命令永不上传',
].filter(Boolean).join('\n');

export const hintForError = (message) => {
  if (message.includes('Manifest hash mismatch') || message.includes('Manifest is missing files')) {
    return 'Hint: run sync after adding or editing files under content/.';
  }
  if (message.includes('Target directory must be empty')) {
    return 'Hint: choose a new empty folder, or remove leftover files first.';
  }
  if (message.includes('Project id is invalid')) {
    return 'Hint: use lowercase id like echo.harbor-theme.';
  }
  if (message.includes('Unsupported template kind')) {
    return 'Hint: --kind theme | lyrics-style | animation-library | visualizer-preset | dsp-preset | audio-plugin-profile | locale-pack | plugin-package | native-shell';
  }
  if (message.includes('Unknown --recipe')) {
    return 'Hint: run recipes to list human-readable starters.';
  }
  if (message.includes('Unsupported --preset')) {
    return 'Hint: theme colors|skin|stylesheet|runtime; lyrics editorial|compact|cinema|cover; visualizer bars|wave|radial; DSP flat|vocal|bass|8bit; plug-in basic|complete|catalog|lyrics|full-trust.';
  }
  if (message.includes('Unknown lyrics slot') || message.includes('Unknown UI capability') || message.includes('Unknown plug-in permission')) {
    return 'Hint: run next . to see host-allowed additions.';
  }
  if (message.includes('Preview must be')) {
    return 'Hint: run fix to generate a 256x256 preview.png, or replace it with a square JPG/PNG/GIF under 1 MB.';
  }
  return null;
};
