/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BundledPluginDefaults } from '../desktop/bundled-plugin-defaults.ts';

const trusted = { id: 'surge-xt', name: 'Surge XT', format: 'vst3', classification: 'instrument',
	binaryPath: '/app/runtime/instruments/Surge XT.vst3', byteLength: 1234, sha256: 'a'.repeat(64) } as const;
const observation = { ...trusted, binaryBytes: trusted.byteLength, binarySha256: trusted.sha256, stableId: 'surge' };
const admission = { status: 'recorded', installationId: 'installation', entryId: 'entry' } as const;

test('only the exact verified app-provided instrument is enabled by default', () => {
	const defaults = new BundledPluginDefaults(), allowed: string[] = [];
	defaults.setVerified([trusted]);
	const registry = { allow(id: string) { allowed.push(id); } };
	for (const change of [{ binaryPath: '/user/Surge XT.vst3' }, { binarySha256: 'b'.repeat(64) },
		{ classification: 'effect' }, { name: 'Surge XT Effects' }, { binaryBytes: 1235 }]) {
		assert.equal(defaults.observe(registry, { ...observation, ...change }, admission), false);
	}
	assert.deepEqual(allowed, []);
	assert.equal(defaults.observe(registry, observation, admission), true);
	assert.deepEqual(allowed, ['installation']);
});

test('explicit disabling survives restart and a new signed binary without clearing quarantine', () => {
	const first = new BundledPluginDefaults(); first.setVerified([trusted]);
	first.observe({ allow() {} }, observation, admission);
	assert.equal(first.setAllowed('installation', false), true);
	const restored = new BundledPluginDefaults(first.exportState());
	restored.setVerified([{ ...trusted, sha256: 'b'.repeat(64) }]);
	assert.equal(restored.observe({ allow() { throw new Error('Must stay disabled'); } }, { ...observation, binarySha256: 'b'.repeat(64) }, admission), false);
	const denied: string[] = [];
	restored.apply({ allow() { throw new Error('A legacy allowance cannot override disabling'); }, withdrawAllowance(id) { denied.push(id); } });
	assert.deepEqual(denied, ['installation']);
	assert.equal(restored.setAllowed('installation', true), true);
	assert.throws(() => restored.observe({ allow() { throw new Error('quarantined'); } }, { ...observation, binarySha256: 'b'.repeat(64) }, admission), /quarantined/u);
});
