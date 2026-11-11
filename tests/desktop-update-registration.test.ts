/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { DesktopSettingsStore } from '../desktop/settings.js';
import { UPDATE_PREFERENCES_CHANNEL } from '../desktop/update-preferences.ts';

for (const [currentVersion, version, tag, name] of [
	['1.0.0-rc.Nov.9.a', '1.0.0-rc.Nov.11.a', 'soundscaper-v1.0.0-rc.Nov.11.a', 'Soundscaper-1.0.0-rc.Nov.11.a-win-x64.exe'],
	['Soundscaper.2026.Nov.10.a', 'Soundscaper-alpha.2026.Nov.11.a', 'Soundscaper-alpha.2026.Nov.11.a', 'Soundscaper-alpha.2026.Nov.11.a-win-x64.exe'],
]) test(`desktop registration prompts and stages ${version} for next launch`, async t => {
	const root = await mkdtemp(join(tmpdir(), 'scape-update-registration-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const output = join(root, 'registration.mjs');
	await build({ entryPoints: ['desktop/update-registration.mjs'], outfile: output, platform: 'node', format: 'esm', bundle: true,
		plugins: [{ name: 'update-runtime-source', setup(builder) {
			builder.onResolve({ filter: /\/project-library-runtime\/(?:desktop\/update-[a-z]+|src\/common\/release\/release-version)\.js$/ }, args => ({
				path: fileURLToPath(new URL(`../${args.path.split('/project-library-runtime/')[1]!.replace('.js', '.ts')}`, import.meta.url)),
			}));
		} }],
	});
	const { createDesktopUpdates } = await import(pathToFileURL(output).href);
	const settings = new DesktopSettingsStore(join(root, 'settings.json'));
	await settings.load(['en']);
	const bytes = Buffer.from('installer fixture');
	let requests = 0;
	let downloads = 0;
	const opened: string[] = [];
	const messages: string[] = [];
	const handlers = new Map<string, (event: unknown, value?: boolean) => Promise<unknown>>();
	const ports = { app: { getVersion: () => currentVersion!.startsWith('Soundscaper') ? '2026.1110.3' : currentVersion }, currentVersion,
		appName: 'Soundscaper', tagPrefix: 'soundscaper-v',
		storage: { stateRoot: root, portable: false }, settings, platform: 'win32', arch: 'x64', appImage: undefined, windowsStore: false,
		shell: { openPath: async (path: string) => { opened.push(path); return ''; } },
		dialog: { showMessageBox: async (_window: unknown, options: { message: string }) => { messages.push(options.message); return { response: 1 }; } }, windowFor: () => ({ isDestroyed: () => false }),
		handle: (channel: string, handler: (event: unknown, value?: boolean) => Promise<unknown>) => { handlers.set(channel, handler); },
		fetchImpl: async (url: string) => {
			if (url.startsWith('https://api.github.com/')) {
				requests++;
				return Response.json([{ tag_name: tag, prerelease: true, assets: [{ name, size: bytes.length,
					digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
					browser_download_url: `https://github.com/LeoWattenberg/Soundscaper/releases/download/${tag}/${name}`,
				}] }]);
			}
			downloads++;
			return new Response(bytes);
		},
	};
	const updates = createDesktopUpdates(ports);
	assert.equal((await updates.check(true)).status, 'available');
	assert.deepEqual(messages, [`${version!.startsWith('Soundscaper') ? version : `Soundscaper ${version}`} is available.`]);
	assert.deepEqual(opened, []);
	assert.equal(downloads, 1);
	assert.deepEqual(await readFile(join(root, 'updates', name)), bytes);
	const preference = handlers.get(UPDATE_PREFERENCES_CHANNEL)!;
	assert.deepEqual(await preference(null, false), { available: true, enabled: false });
	await createDesktopUpdates(ports).startup();
	assert.deepEqual(opened, [join(root, 'updates', name)]);
	assert.equal(requests, 1, 'a pending installation takes precedence over the automatic-check preference');
	assert.equal(downloads, 1, 'restart uses the staged installer');
	createDesktopUpdates({ ...ports, storage: { ...ports.storage, portable: true } });
	assert.deepEqual(await handlers.get(UPDATE_PREFERENCES_CHANNEL)!(null, true), { available: false, enabled: false });
	assert.equal(settings.snapshot().updatesEnabled, false);
});
