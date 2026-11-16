/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { WindowsVst2BridgeConsent } from '../desktop/windows-vst2-bridge-consent.ts';
import { validateHelperJobGrant } from '../desktop/helper-job-grant.ts';

test('bridge consent defaults off, persists explicit changes, and remains Windows x64 only', async () => {
	const saved: boolean[] = [];
	const consent = new WindowsVst2BridgeConsent({ target: 'win-x64', state: undefined,
		persist: async (enabled) => { saved.push(enabled); } });
	assert.deepEqual(consent.describe(), { supported: true, enabled: false });
	await consent.setEnabled(true); assert.equal(consent.enabled, true);
	await consent.setEnabled(false); assert.equal(consent.enabled, false);
	assert.deepEqual(saved, [true, false]);
	for (const target of ['win-arm64', 'linux-x64', 'mac-arm64']) {
		const unavailable = new WindowsVst2BridgeConsent({ target, state: true, persist: async () => {} });
		assert.equal(unavailable.enabled, false);
		await assert.rejects(unavailable.setEnabled(true), /Windows x64/u);
	}
});

test('failed persistence does not grant bridge consent', async () => {
	const consent = new WindowsVst2BridgeConsent({ target: 'win-x64', state: {},
		persist: async () => { throw new Error('disk full'); } });
	await assert.rejects(consent.setEnabled(true), /disk full/u);
	assert.equal(consent.enabled, false);
});

test('bridge grants accept only an explicit true for VST2 and retain it across validation', () => {
	const scan = { rootPath: '/plugins', format: 'vst2', identity: { dev: 1, ino: 2 }, windowsX86Vst2: true };
	assert.equal(validateHelperJobGrant('plugin-scan', scan).windowsX86Vst2, true);
	const host = { binaryPath: '/plugins/legacy.dll', binaryBytes: 512, binarySha256: 'a'.repeat(64),
		format: 'vst2', stableId: 'vst2:1', identity: { dev: 1, ino: 2 }, windowsX86Vst2: true };
	assert.equal(validateHelperJobGrant('plugin-host', host).windowsX86Vst2, true);
	for (const windowsX86Vst2 of [false, 'true', 1, null]) {
		assert.throws(() => validateHelperJobGrant('plugin-scan', { ...scan, windowsX86Vst2 }));
		assert.throws(() => validateHelperJobGrant('plugin-host', { ...host, windowsX86Vst2 }));
	}
	assert.throws(() => validateHelperJobGrant('plugin-scan', { ...scan, format: 'vst3' }));
	assert.throws(() => validateHelperJobGrant('plugin-host', { ...host, format: 'clap' }));
});
