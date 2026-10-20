/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('retime control retains current evidence and separates historical provenance', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'current-video-retime-admission',
	);
	assert.ok(control);
	assert.equal(control.policyAuthority, 'family-v1-active');
	assert.deepEqual(control.evidence, [
		{ kind: 'implementation', path: 'src/common/editor/video-retime-v16.ts' },
		{ kind: 'implementation', path: 'src/common/editor/video-retime-web-core-ordinal-authority.ts' },
		{ kind: 'implementation', path: 'src/framescaper/editor-project-retime.ts' },
		{ kind: 'test', path: 'tests/audio-editor-video-retime-web-core-ordinal-authority.test.ts' },
		{ kind: 'test', path: 'tests/audio-editor-framescaper-baseline.test.ts' },
	]);

	assert.equal(control.historicalPreFreezeNarrative?.status, 'provenance-only-not-runtime-authority');
	assert.equal(control.historicalPreFreezeNarrative?.formerId, 'v16-video-retime-preservation-admission');
});
