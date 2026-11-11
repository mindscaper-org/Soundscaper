/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_EFFECT_CONTRACT_CHUNK_TEST, EDITOR_DOMAIN_CHUNK_TEST } from '../scripts/lib/build-chunk-tests.mjs';

test('phase definitions share the existing effect-contract chunk without pulling processing into startup', () => {
	for (const path of ['first-party-effects/selection-definitions.ts', 'first-party-effects/phase-correction/definition.ts']) {
		assert.ok(EDITOR_EFFECT_CONTRACT_CHUNK_TEST.test(`/repo/src/common/editor/${path}`), path);
	}
	assert.ok(EDITOR_DOMAIN_CHUNK_TEST.test('/repo/src/common/editor/first-party-effects/phase-correction/contract.ts'));
	for (const module of ['selection', 'correlation']) {
		const path = `/repo/src/common/editor/first-party-effects/phase-correction/${module}.ts`;
		assert.ok(!EDITOR_EFFECT_CONTRACT_CHUNK_TEST.test(path));
		assert.ok(!EDITOR_DOMAIN_CHUNK_TEST.test(path));
	}
});
