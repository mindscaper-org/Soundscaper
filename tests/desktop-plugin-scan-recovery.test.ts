/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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


test('bridge preference IPC persists Windows x64 opt-in and restores it without enabling other targets', async (t) => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'bridge-preference-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const handlers = new Map<string, (event?: unknown, value?: unknown) => Promise<unknown>>();
	const register = (target: string) => registerDesktopPluginDiscovery({
		channels: new Proxy({}, { get: (_target, key) => key }),
		handle: (channel: string, handler: (event?: unknown, value?: unknown) => Promise<unknown>) => handlers.set(channel, handler),
		ownerFor: () => ({}), userDataPath, nativePluginBridgeTarget: target,
		stateDataPath: undefined, parentWindow: () => null, desktopRoot: userDataPath, packaged: false, resourcesPath: undefined,
		settings: { snapshot: () => ({ nativePluginDiscoveryEnabled: true }) },
		supervisor: { runJob: async () => { throw new Error('unused'); }, snapshot: () => ({ quarantined: false }),
			clearQuarantine: () => undefined, dispose: () => undefined },
		describePayload: async () => ({ status: 'available' }), isPluginHostFormatActivated: () => true,
	});
	const registration = register('win-x64'); await registration.ready();
	const consent = handlers.get('nativePluginConsent'); assert.ok(consent);
	assert.deepEqual(await consent({}, { format: 'vst2', action: 'enable-x86-vst2' }), { supported: true, enabled: true });
	assert.deepEqual(JSON.parse(await readFile(join(userDataPath, 'windows-vst2-x86-consent-v1.json'), 'utf8')), { enabled: true });
	await registration.dispose();
	const restored = register('win-x64'); await restored.ready();
	const availability = handlers.get('nativePluginAvailability'); assert.ok(availability);
	const result = await availability() as { consent: { windowsX86Vst2: unknown } };
	assert.deepEqual(result.consent.windowsX86Vst2, { supported: true, enabled: true });
	const disable = handlers.get('nativePluginConsent'); assert.ok(disable);
	await disable({}, { format: 'vst2', action: 'disable-x86-vst2' });
	assert.deepEqual(JSON.parse(await readFile(join(userDataPath, 'windows-vst2-x86-consent-v1.json'), 'utf8')), { enabled: false });
	await restored.dispose();
	const arm = register('win-arm64'); await arm.ready();
	const refused = handlers.get('nativePluginConsent'); assert.ok(refused);
	await assert.rejects(refused({}, { format: 'vst2', action: 'enable-x86-vst2' }), /Windows x64/u);
	await arm.dispose();
});
