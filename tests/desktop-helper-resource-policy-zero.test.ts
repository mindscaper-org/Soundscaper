/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeHelperResourcePolicy, validateHelperWireResourcePolicy } from '../desktop/helper-resource-policy.ts';

test('speech helpers admit zero output, scratch and data-plane authority', () => {
	const policy = normalizeHelperResourcePolicy({ maximumOutputBytes: 0, maximumScratchBytes: 0 }, 'assistance-speech');
	assert.equal(policy.maximumOutputBytes, 0);
	assert.equal(policy.maximumScratchBytes, 0);
	assert.equal(policy.maximumDataPlaneBytes, 0);
	assert.equal(policy.maximumInFlightChunks, 0);
	assert.deepEqual(validateHelperWireResourcePolicy(policy, 'assistance-speech'), policy);
	for (const key of ['maximumOutputBytes', 'maximumScratchBytes', 'maximumDataPlaneBytes', 'maximumInFlightChunks'] as const) {
		assert.throws(() => normalizeHelperResourcePolicy({ [key]: -1 }, 'assistance-speech'), /lower-only/u);
		assert.throws(() => normalizeHelperResourcePolicy({ [key]: .5 }, 'assistance-speech'), /lower-only/u);
	}
	assert.throws(() => normalizeHelperResourcePolicy({ maximumDataPlaneBytes: 1 }, 'assistance-speech'), /lower-only/u);
});
