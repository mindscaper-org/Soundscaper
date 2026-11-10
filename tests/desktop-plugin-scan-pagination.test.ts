/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePluginScanCursor } from '../desktop/helper-job-grant.ts';
import { ENTRY, ROOT, SCAN, createService, failed } from './helpers/desktop-plugin-scan-service-fixture.ts';

test('large plugin scans follow bounded pages without truncating their inventory', async () => {
	const { service, requests } = createService({ run: async (request) => {
		const page = request.grant.cursor?.candidateIndex ?? 0;
		return { ...SCAN, entries: [{ ...ENTRY, stableId: `effect-${page}` }],
			...(page < 649 ? { status: 'root-oversized', next: { candidateIndex: page + 1, descriptorIndex: 0 } } : {}) };
	} });
	const result = await service.scanRoot({ owner: {}, rootId: 'root-1', format: 'vst3' });
	assert.equal(result.status, 'described');
	if (result.status !== 'described') return;
	assert.equal(result.scan.status, 'scanned');
	assert.equal(result.scan.entries.length, 650);
	assert.deepEqual(result.scan.entries.map(({ stableId }) => stableId),
		Array.from({ length: 650 }, (_, index) => `effect-${index}`));
	assert.equal(requests.length, 650);
	assert.doesNotMatch(JSON.stringify(result), /binaryPath|candidateIndex|descriptorIndex/u);
});

test('plugin pagination rejects a non-advancing cursor and duplicate identities across pages', async () => {
	for (const duplicate of [false, true]) {
		let calls = 0;
		const { service, quarantined } = createService({ run: async () => {
			calls += 1;
			return { ...SCAN, entries: [{ ...ENTRY, stableId: duplicate ? ENTRY.stableId : `effect-${calls}` }],
				status: 'root-oversized', next: { candidateIndex: 1, descriptorIndex: 0 } };
		} });
		const result = await service.scanRoot({ owner: {}, rootId: 'root-1', format: 'vst3' });
		assert.equal(failed(result).fault?.reason, 'malformed-answer');
		assert.equal(calls, 2);
		assert.deepEqual(quarantined, [[ROOT.scanDigest, 'malformed-answer']]);
	}
});

test('scan cursors admit only exact non-negative indices', () => {
	for (const cursor of [null, [], { candidateIndex: -1, descriptorIndex: 0 },
		{ candidateIndex: 0, descriptorIndex: 0.5 }, { candidateIndex: '1', descriptorIndex: 0 },
		{ candidateIndex: 0, descriptorIndex: 0, path: '/plugins' },
		{ candidateIndex: Number.MAX_SAFE_INTEGER + 1, descriptorIndex: 0 }]) {
		assert.throws(() => validatePluginScanCursor(cursor));
	}
});

test('all scan pages share the original root duration budget', async context => {
	context.mock.timers.enable({ apis: ['Date'], now: 0 });
	const { service, requests } = createService({ run: async () => {
		context.mock.timers.tick(300_001);
		return { ...SCAN, status: 'root-oversized', next: { candidateIndex: 1, descriptorIndex: 0 } };
	} });
	assert.equal(failed(await service.scanRoot({ owner: {}, rootId: 'root-1', format: 'vst3' })).fault?.reason, 'scanner-hang');
	assert.equal(requests.length, 1);
});

test('withdrawn scan consent between pages publishes no partial inventory', async () => {
	const fixture = createService({ run: async () => {
		fixture.grants.clear();
		return { ...SCAN, status: 'root-oversized', next: { candidateIndex: 1, descriptorIndex: 0 } };
	} });
	const result = failed(await fixture.service.scanRoot({ owner: {}, rootId: 'root-1', format: 'vst3' }));
	assert.equal(result.code, 'consent-required');
	assert.equal(fixture.requests.length, 1);
	assert.deepEqual(fixture.quarantined, []);
});

