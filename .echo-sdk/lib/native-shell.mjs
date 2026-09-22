import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const contract = JSON.parse(
  readFileSync(new URL('../contracts/native-shell.json', import.meta.url), 'utf8'),
);
const limits = JSON.parse(
  readFileSync(new URL('../contracts/native-shell-limits.json', import.meta.url), 'utf8'),
);

export const nativeShellPermissions = Object.freeze([...contract.permissions]);
export const nativeShellLimits = limits;
export const nativeShellContract = contract;
export const nativeShellExePattern = /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^<>:"|?*]+\.[eE][xX][eE]$/u;

const permissionSet = new Set(nativeShellPermissions);
const exePattern = nativeShellExePattern;

export const createNativeShellEntry = (id, title) => ({
  type: 'echo-workshop-native-shell',
  schemaVersion: 1,
  id,
  title,
  description: 'A Windows taskbar shell process. The host spawns the packaged exe and speaks native-shell protocol v1 over a named pipe.',
  protocolVersion: 1,
  platforms: ['win32'],
  exe: 'host/EchoShell.exe',
  renderer: 'renderer.js',
  config: 'config.json',
  configSchema: 'config.schema.json',
  configUi: 'config-ui.js',
  permissions: [...nativeShellPermissions],
  pipe: { argument: '--pipe', stdio: 'ignore' },
});

export const createNativeShellExtraFiles = () => [
  {
    path: 'renderer.js',
    content: `/* native-shell renderer: poll playback and push status through the loader host. */
export const activate = (api) => {
  const timer = setInterval(() => {
    void api?.refresh?.();
  }, 1000);
  return () => clearInterval(timer);
};
`,
  },
  {
    path: 'config.json',
    content: `${JSON.stringify({ widgetWidth: 360, uiScale: 100, alignment: 'right' }, null, 2)}\n`,
  },
  {
    path: 'config.schema.json',
    content: `${JSON.stringify({
      type: 'object',
      properties: {
        widgetWidth: { type: 'integer', minimum: 200, maximum: 800, default: 360 },
        uiScale: { type: 'integer', minimum: 50, maximum: 200, default: 100 },
        alignment: { type: 'string', enum: ['left', 'center', 'right'], default: 'right' },
      },
    }, null, 2)}\n`,
  },
  {
    path: 'config-ui.js',
    content: `const { root, schema, config } = echoConfigUi;
const draft = { widgetWidth: 360, uiScale: 100, alignment: 'right', ...(config && typeof config === 'object' ? config : {}) };
root.textContent = '';
const note = document.createElement('p');
note.textContent = (schema && schema.title) || 'Native shell settings. Width, scale and alignment apply after save.';
root.append(note);
echoConfigUi.onSave(() => draft);
`,
  },
  {
    path: 'host/README.md',
    content: `# Host binary

Drop the unpackaged Windows executable at \`EchoShell.exe\` in this folder before publishing.

The host starts it as:

    EchoShell.exe --pipe <name>

stdio must stay ignored. WinUI WinExe crashes if stdin/stdout are redirected.

Authoring \`check\` and \`test\` pass without the exe. A live ECHO / ShinawaseLoader host requires the file.
`,
  },
];

export const validateNativeShellEntry = (value, expectedId) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'echo-workshop-native-shell' || value.schemaVersion !== 1) {
    throw new Error('native-shell.json has an invalid package header');
  }
  if (value.id !== expectedId) throw new Error('native-shell id must match the outer manifest');
  if (value.protocolVersion !== 1) throw new Error('native-shell protocolVersion must be 1');
  if (!Array.isArray(value.platforms) || !value.platforms.includes('win32')) throw new Error('native-shell platforms must include win32');
  if (typeof value.exe !== 'string' || !exePattern.test(value.exe)) throw new Error('native-shell exe path is invalid');
  if (!Array.isArray(value.permissions) || value.permissions.length < 1) throw new Error('native-shell permissions are required');
  for (const permission of value.permissions) {
    if (!permissionSet.has(permission)) throw new Error(`Unsupported native-shell permission: ${permission}`);
  }
  for (const key of ['renderer', 'config', 'configSchema', 'configUi', 'icon']) {
    const path = value[key];
    if (path == null) continue;
    if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || path.includes('..')) {
      throw new Error(`native-shell ${key} path is invalid`);
    }
  }
  return value;
};

export const testNativeShell = (entry) => {
  const checks = [];
  const push = (id, ok, error) => {
    checks.push({ id, ok, error: ok ? undefined : error });
  };
  try {
    validateNativeShellEntry(entry, entry?.id);
    push('header', true);
  } catch (error) {
    push('header', false, error instanceof Error ? error.message : String(error));
  }
  push('protocol', entry?.protocolVersion === 1, 'protocolVersion must be 1');
  push('exe-path', typeof entry?.exe === 'string' && exePattern.test(entry.exe), 'exe must be a relative .exe path');
  push('permissions', Array.isArray(entry?.permissions) && entry.permissions.every((item) => permissionSet.has(item)), 'permissions must be from the native-shell contract');
  push('exe-extension', extname(String(entry?.exe || '')).toLowerCase() === '.exe', 'exe extension must be .exe');
  return { ok: checks.every((check) => check.ok), kind: 'native-shell', fixtures: ['schema', 'protocol-v1'], checks };
};
