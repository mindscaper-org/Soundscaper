/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_EFFECT_CONTRACT_CHUNK_TEST, EDITOR_DOMAIN_CHUNK_TEST } from '../scripts/lib/build-chunk-tests.mjs';

test('Match EQ shares effect contracts without admitting FFT analysis or FIR processing into startup', () => {
	const root = '/repo/src/common/editor/first-party-effects/match-eq/';
	assert.ok(EDITOR_EFFECT_CONTRACT_CHUNK_TEST.test(`${root}definition.ts`));
	assert.ok(EDITOR_DOMAIN_CHUNK_TEST.test(`${root}contract.ts`));
	for (const module of ['analysis', 'curve', 'selection']) {
		assert.ok(!EDITOR_EFFECT_CONTRACT_CHUNK_TEST.test(`${root}${module}.ts`));
		assert.ok(!EDITOR_DOMAIN_CHUNK_TEST.test(`${root}${module}.ts`));
	}
});
