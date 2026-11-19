/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { bundledNativePlugins } from '../desktop/bundled-native-plugins.ts';
import { createBundledPluginStartup } from '../desktop/bundled-plugin-startup.ts';
import { verifyBundledPluginCandidates } from '../desktop/bundled-plugin-verification.ts';
import { authenticatePluginCandidate } from '../desktop/plugin-candidate-authentication.mjs';
import { DesktopPluginRegistry, type PluginScanObservation } from '../desktop/plugin-registry.ts';
import type { NativeAddonAvailability } from '../desktop/native-addon-payload.ts';

async function fixture(context: { after(fn: () => Promise<void>): void }) {
	const root = await mkdtemp(join(tmpdir(), 'bundled-plugin-startup-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const artifacts = [];
	for (const plugin of bundledNativePlugins('linux-x64')) {
		const path = join(root, 'runtime', plugin.binaryPath), bytes = Buffer.from(plugin.name);
		await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes);
		artifacts.push({ path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
	}
	return { root, descriptor: { target: 'linux-x64', pluginPeer: { path: join(root, 'peer'), byteLength: 1, sha256: 'a'.repeat(64) },
		isolation: { runtimeClosure: artifacts, pluginResources: [] } } };
}

test('fresh installs discover and allow only authenticated app-owned synths without external folder consent', async context => {
	const { root, descriptor } = await fixture(context);
	const verified = await verifyBundledPluginCandidates(descriptor, authenticatePluginCandidate);
	const registry = new DesktopPluginRegistry({ isQuarantined: () => false });
	const roots: string[] = [], writes: string[] = [];
	const startup = createBundledPluginStartup({ registry,
		describePayload: async () => ({ status: 'available', descriptor } as unknown as NativeAddonAvailability),
		isEnabled: () => true, isFormatActive: () => true, authenticate: authenticatePluginCandidate,
		preferencesPath: join(root, 'preferences.json'), writeFile: async (_path, body) => { writes.push(body); },
		allowances: { apply() {}, capture: async () => {} },
		quarantine: { isQuarantined: () => false, quarantine() {} },
		supervisor: { snapshot: () => ({ state: 'ready', quarantined: false }), clearQuarantine() {}, dispose() {},
			async runJob(request) {
				roots.push(request.grant.rootPath);
				for (const plugin of verified.filter(plugin => dirname(plugin.binaryPath) === request.grant.rootPath && plugin.format === request.grant.format)) {
					const observation: PluginScanObservation = { ...plugin, format: plugin.format as 'vst3' | 'clap',
						classification: plugin.classification as 'effect' | 'instrument', stableId: plugin.id, bundleStableIds: [plugin.id],
						vendor: 'Test', version: '1', platform: 'linux', architecture: 'x64', binaryBytes: plugin.byteLength, binarySha256: plugin.sha256,
						identity: { dev: 1, ino: 2 }, topologies: [{ inputChannels: plugin.classification === 'instrument' ? 0 : 2, outputChannels: 2 }],
						realtimeSupported: true, offlineSupported: true, compatibility: 'compatible', reportedLatencyFrames: 0, descriptorVersion: 1 };
					startup.observe(observation, registry.record(observation));
				}
				return { format: request.grant.format, status: 'scanned', detail: '', entries: [] };
			} },
	});
	await startup.ready();
	assert.deepEqual(registry.describe().entries.map(entry => [entry.name, entry.installations[0]!.allowed]),
		[['Soundscaper JUCE effects', true], ['Surge XT', true], ['Dexed', true]]);
	assert.equal(roots.length, 2);
	assert.ok(roots.every(path => path.startsWith(join(root, 'runtime'))));
	const synth = registry.describe().entries.find(entry => entry.name === 'Surge XT')!.installations[0]!;
	await startup.setAllowed(synth.installationId, false);
	assert.deepEqual(JSON.parse(writes[0]!), { schemaVersion: 1, disabled: ['surge-xt:surge-xt'] });
	await startup.ready(); assert.equal(roots.length, 2);
	startup.dispose();
});

test('unexpected bundle bytes are refused before any app plug-in is executed', async context => {
	const { root, descriptor } = await fixture(context);
	await writeFile(join(root, 'runtime/instruments/Surge XT.vst3/unlisted.txt'), 'unexpected');
	await assert.rejects(verifyBundledPluginCandidates(descriptor, authenticatePluginCandidate), /differ from the package authority/u);
});

test('an unlisted effect cannot be executed through the private bundled scan root', async context => {
	const { root, descriptor } = await fixture(context);
	await writeFile(join(root, 'runtime/effects/extra.clap'), 'unexpected');
	await assert.rejects(verifyBundledPluginCandidates(descriptor, authenticatePluginCandidate), /does not match its authenticated inventory/u);
});
