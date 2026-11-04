/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'electron/main') return { url: 'stub-electron:scan-recovery', shortCircuit: true };
		if (specifier === './project-library-runtime/src/common/editor/ara-contract.js') {
			return nextResolve('../src/common/editor/ara-contract.ts', context);
		}
		const prefix = './project-library-runtime/desktop/';
		return nextResolve(specifier.startsWith(prefix) ? `./${specifier.slice(prefix.length).replace(/\.js$/u, '.ts')}` : specifier, context);
	},
	load(url, context, nextLoad) {
		return url === 'stub-electron:scan-recovery' ? { format: 'module', shortCircuit: true, source: `
			export const app = { getAppMetrics: () => [] };
			export const dialog = {};
			export class MessageChannelMain {}
			export const utilityProcess = {};
		` } : nextLoad(url, context);
	},
});

const { registerDesktopPluginDiscovery } = await import('../desktop/plugin-registration.mjs');

test('clearing a scanner quarantine also releases its supervisor hold so scanning can resume', async (t) => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'scan-recovery-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	let held = true;
	const handlers = new Map<string, (event?: unknown, value?: unknown) => Promise<unknown>>();
	const channels = new Proxy({}, { get: (_target, key) => key });
	const registration = registerDesktopPluginDiscovery({
		channels, handle: (channel: string, handler: (event?: unknown, value?: unknown) => Promise<unknown>) => handlers.set(channel, handler),
		ownerFor: () => ({}), userDataPath,
		stateDataPath: undefined, parentWindow: () => null, desktopRoot: userDataPath, packaged: false, resourcesPath: undefined,
		settings: { snapshot: () => ({ nativePluginDiscoveryEnabled: true }) },
		supervisor: { runJob: async () => { throw new Error('unused'); }, snapshot: () => ({ quarantined: held }),
			clearQuarantine: () => { held = false; }, dispose: () => undefined },
		describePayload: async () => ({ status: 'available' }), isPluginHostFormatActivated: () => true,
	});
	t.after(() => registration.dispose());
	await registration.ready();
	const clear = handlers.get('nativePluginClearQuarantine');
	assert.ok(clear);
	await clear({}, { digest: 'b'.repeat(64), clearance: 'rescan' });
	assert.equal(held, true, 'an unknown digest must not release a scanner hold');
	const digest = 'a'.repeat(64);
	await registration.quarantine.record({ digest, scope: 'scanner', kind: 'crash' });
	assert.deepEqual(await clear({}, { digest, clearance: 'rescan' }), { cleared: true });
	assert.equal(held, false);
	assert.equal(registration.quarantine.isQuarantined(digest), false);
});
