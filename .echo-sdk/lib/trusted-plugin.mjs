export const fullTrustPluginPreset = 'full-trust';
export const fullTrustMinimumEchoVersion = '26.8.29';
export const trustedEntryFileName = 'trusted.mjs';

export const trustedRuntimeStarterSource = `/**
 * Full-trust code runs in an ECHO utility process after the subscriber approves
 * desktop-application-equivalent access. Build and install dependencies in your
 * own Node.js environment; ECHO does not provision an author toolchain.
 *
 * @param {{ method: string, input?: unknown }} request
 * @param {{ pluginId: string, revision: string, contentRoot: string }} context
 */
export async function handle(request, context) {
  if (request.method === 'runtime-info') {
    return {
      pluginId: context.pluginId,
      revision: context.revision,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    };
  }
  throw new Error(\`Unknown trusted method: \${request.method}\`);
}
`;

export const fullTrustSandboxStarterSource = `/// <reference path="../.echo-sdk/echo-workshop-plugin.d.ts" />

echo.commands.register('runtime-info', { title: 'Show trusted runtime info' }, async () => {
  try {
    /** @type {{ node?: string, platform?: string, arch?: string }} */
    const info = await echo.trusted.invoke('runtime-info');
    await echo.ui.notify(\`Node \${info.node ?? '?'} · \${info.platform ?? '?'} · \${info.arch ?? '?'}\`);
    return info;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('mock host does not execute full-trust code')) {
      await echo.ui.notify('Manifest and bridge verified. Run this command inside ECHO to execute trusted.mjs.');
      return { mockOnly: true };
    }
    throw error;
  }
});
`;

export const createFullTrustPluginEntry = (id, title) => ({
  type: 'echo-plugin-package',
  version: 1,
  exportedAt: new Date().toISOString(),
  manifest: {
    id,
    name: title,
    version: '1.0.0',
    apiVersion: 2,
    entry: 'plugin.js',
    trustedEntry: trustedEntryFileName,
    permissions: ['system:full'],
    contributes: {
      commands: [{ id: 'runtime-info', title: 'Show trusted runtime info' }],
    },
  },
  files: [],
});

export const createFullTrustPluginSourceFiles = () => [
  { path: 'plugin.js', content: fullTrustSandboxStarterSource },
  { path: trustedEntryFileName, content: trustedRuntimeStarterSource },
];
