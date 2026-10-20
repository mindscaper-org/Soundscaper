/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('reviewed-effects inventory retains the closed catalog controls and their verification evidence', async () => {
	const matrix = JSON.parse(await readFile(
		new URL('../config/production-security-matrix.json', import.meta.url),
		'utf8',
	));
	const risk = matrix.risks.find(({ id }) => id === 'reviewed-web-effect-packages');

	assert.ok(risk);
	assert.equal(risk.status, 'enforced');
	assert.equal(risk.surfaceDisposition, 'verified-current-surface');
	assert.deepEqual(risk.residualRisks, []);
	assert.deepEqual(risk.currentControls.map(({ id }) => id), [
		'release-pinned-reviewed-effect-catalog',
		'closed-reviewed-effect-wasm-abi',
		'terminating-reviewed-effect-offline-worker',
		'static-reviewed-effect-realtime-host',
	]);
	for (const control of risk.currentControls) {
		assert.ok(control.evidence.some(({ kind }) => kind === 'implementation'));
		assert.ok(control.evidence.some(({ kind, path }) => kind === 'test'
			&& path === 'tests/audio-editor-reviewed-effects.test.ts'));
	}
});

test('licensing inventory keeps external effect packages disabled', async () => {
	const licensingMatrix = JSON.parse(await readFile(
		new URL('../config/production-licensing-matrix.json', import.meta.url), 'utf8',
	));
	const gate = licensingMatrix.futureDistributionGates.find(
		({ id }) => id === 'web-effect-packages',
	);
	assert.equal(gate.status, 'disabled');
	assert.equal(gate.scope, 'externally-authored-or-non-repository-owned-packages');
});
