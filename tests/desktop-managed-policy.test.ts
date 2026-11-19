/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveManagedPolicy } from '../desktop/managed-policy.ts';
import { enforceManagedIpc, managedFetch, managedRequestAllowed } from '../desktop/managed-network-policy.ts';
import { DesktopSettingsStore } from '../desktop/settings.js';

test('machine policy wins per value, and the online master overrides feature permissions', () => {
	const policy = resolveManagedPolicy({ machine: { OnlineFeaturesAllowed: 0, FreesoundAllowed: 1 },
		user: { OnlineFeaturesAllowed: 1, ApplicationUpdatesAllowed: 0 } });
	assert.equal(policy.allows('FreesoundAllowed'), false);
	assert.equal(policy.allows('ApplicationUpdatesAllowed'), false);
	assert.equal(policy.allows('LocalIntegrationsAllowed'), true);
	assert.equal(resolveManagedPolicy().allows('ApplicationUpdatesAllowed'), true);
});

test('MSI installations prohibit self updates even when policy enables them', () => {
	assert.equal(resolveManagedPolicy({ msi: true, machine: { ApplicationUpdatesAllowed: 1 } }).allows('ApplicationUpdatesAllowed'), false);
});

test('launch presets merge individual machine and user values without accepting prototype keys', () => {
	const user = JSON.stringify({ schemaVersion: 1, desktop: { updatesEnabled: false }, editor: { appearance: { theme: 'light', defaultView: 'spectrogram' } } });
	const machine = JSON.stringify({ schemaVersion: 1, desktop: { locale: 'de' }, editor: { appearance: { theme: 'dark' } } });
	const policy = resolveManagedPolicy({ machine: { LaunchPreferences: machine }, user: { LaunchPreferences: user } });
	assert.deepEqual(policy.desktopPreferences, { updatesEnabled: false, locale: 'de' });
	assert.deepEqual(policy.editorPreferences, { appearance: { theme: 'dark', defaultView: 'spectrogram' } });
	assert.throws(() => resolveManagedPolicy({ machine: { LaunchPreferences: '{"schemaVersion":1,"editor":{"__proto__":{}}}' } }), /preference/iu);
	assert.throws(() => resolveManagedPolicy({ machine: { OnlineFeaturesAllowed: '0' } }), /DWORD/u);
	assert.throws(() => resolveManagedPolicy({ machine: { LaunchPreferences: '{"schemaVersion":2}' } }), /schema/u);
});

test('network restrictions cover direct IPC and Node requests before any operation starts', async () => {
	const policy = resolveManagedPolicy({ machine: { OnlineFeaturesAllowed: 0, LocalIntegrationsAllowed: 0 } });
	for (const channel of ['soundscaper:v1:updates:check', 'soundscaper:v1:assistance:install', 'soundscaper:v1:ffmpeg:install',
		'soundscaper:v1:freesound:authorize', 'soundscaper:v1:audiocom:link', 'soundscaper:v1:mcp:start', 'soundscaper:blender:select']) {
		assert.throws(() => enforceManagedIpc(policy, channel, [{ live: true }]), /policy/u);
	}
	assert.doesNotThrow(() => enforceManagedIpc(policy, 'soundscaper:blender:select', [{ live: false }]));
	assert.doesNotThrow(() => enforceManagedIpc(policy, 'soundscaper:v1:assistance:install-preseeded', []));
	let requests = 0;
	const fetcher = managedFetch(policy, 'ModelDownloadsAllowed', async () => { requests++; return new Response(); });
	await assert.rejects(fetcher('https://example.org/model'), /policy/u);
	assert.equal(requests, 0);
});

test('request filtering preserves local application assets and restricts remote provider media', () => {
	const policy = resolveManagedPolicy({ machine: { FreesoundAllowed: 0 } });
	assert.equal(managedRequestAllowed(policy, 'soundscaper://app/runtime/model.wasm'), true);
	assert.equal(managedRequestAllowed(policy, 'https://soundscaper.org/api/freesound/preview'), false);
	assert.equal(managedRequestAllowed(policy, 'https://soundscaper.org/api/audiocom/media'), true);
	assert.equal(managedRequestAllowed(resolveManagedPolicy({ machine: { OnlineFeaturesAllowed: 0 } }), 'https://example.org'), false);
});

test('external-link restrictions preserve local semantic authorization but block provider handoffs', () => {
	const policy = resolveManagedPolicy({ machine: { ExternalLinksAllowed: 0 } });
	assert.doesNotThrow(() => enforceManagedIpc(policy, 'soundscaper:v1:assistance:semantic-search:authorize', []));
	for (const channel of ['soundscaper:v1:freesound:authorize', 'soundscaper:v1:audiocom:authorize', 'soundscaper:v1:audiocom:link']) {
		assert.throws(() => enforceManagedIpc(policy, channel, []), /ExternalLinksAllowed/u);
	}
});

test('desktop presets reset selected saved values on relaunch and retain unrelated user preferences', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-managed-settings-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'settings.json');
	const saved = new DesktopSettingsStore(path);
	await saved.load(['en']);
	await saved.setLocale('fr');
	await saved.setUpdatesEnabled(false);
	await saved.setNativeAudioHelperEnabled(true);
	const policy = resolveManagedPolicy({ machine: { LaunchPreferences: '{"schemaVersion":1,"desktop":{"locale":"de"}}' } });
	for (let launch = 0; launch < 2; launch++) {
		const settings = new DesktopSettingsStore(path);
		await settings.load(['en'], policy.desktopPreferences);
		assert.equal(settings.snapshot().locale, 'de');
		assert.equal(settings.snapshot().updatesEnabled, false);
		assert.equal(settings.snapshot().nativeAudioHelperEnabled, true);
		await settings.setLocale('fr');
		assert.equal(settings.snapshot().locale, 'fr');
	}
});
