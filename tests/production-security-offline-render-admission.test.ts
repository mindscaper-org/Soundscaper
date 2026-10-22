/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface SecurityEvidence {
	readonly kind: string;
	readonly path: string;
}

interface SecurityControl {
	readonly id: string;
	readonly evidence: readonly SecurityEvidence[];
}

interface SecurityResidual {
	readonly id: string;
	readonly ownerMilestone: string;
	readonly acceptanceCriteria: readonly string[];
}

interface SecurityRisk {
	readonly id: string;
	readonly status: string;
	readonly currentControls: readonly SecurityControl[];
	readonly residualRisks: readonly SecurityResidual[];
}

interface SecurityMatrix {
	readonly risks: readonly SecurityRisk[];
}

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

const EXPECTED_EVIDENCE = [
	{ kind: 'implementation', path: 'src/common/editor/engine/offline-render-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/engine/rendering.ts' },
	{ kind: 'implementation', path: 'src/common/editor/export-render-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/export.js' },
	{ kind: 'test', path: 'tests/audio-editor-offline-render-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-export-render-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-export-strategy-admission.test.ts' },
] as const;

test('central offline-render output admission retains its required control and runtime evidence', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8')) as SecurityMatrix;
	const cancellation = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	assert.ok(cancellation, 'long-job-cancellation risk is required');
	assert.equal(cancellation.status, 'partial');

	const admission = cancellation.currentControls.find(
		({ id }) => id === 'bounded-offline-render-output-pcm',
	);
	assert.ok(admission, 'bounded offline-render output control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(
			admission.evidence.some(
				({ kind, path }) => kind === expected.kind && path === expected.path,
			),
			`offline-render admission needs ${expected.kind} evidence from ${expected.path}`,
		);
	}

	const residual = cancellation.residualRisks.find(
		({ id }) => id === 'render-worker-resident-set-accounting',
	);
	assert.ok(residual, 'render and worker resident-set residual is required');
	assert.equal(residual.ownerMilestone, '2');
	assert.ok(residual.acceptanceCriteria.length > 0);
});
