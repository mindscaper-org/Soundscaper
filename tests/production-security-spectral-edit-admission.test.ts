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
	{ kind: 'implementation', path: 'src/common/editor/spectral-edit-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/controller/effects/internal/effect-audio-service.ts' },
	{ kind: 'implementation', path: 'src/common/editor/controller/effects/internal/effect-result-service.ts' },
	{ kind: 'implementation', path: 'src/common/editor/controller/effects/internal/selection-effect-worker-service.ts' },
	{ kind: 'implementation', path: 'src/common/editor/spectral-edit-worker.js' },
	{ kind: 'implementation', path: 'src/common/editor/spectral-edit.js' },
	{ kind: 'implementation', path: 'src/common/editor/pffft.js' },
	{ kind: 'test', path: 'tests/audio-editor-spectral-edit-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-effect-audio-service.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-effect-result-service.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-selection-effect-worker-service.test.ts' },
] as const;

test('spectral edit admission retains its required control and runtime evidence', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8')) as SecurityMatrix;
	const cancellation = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	assert.ok(cancellation, 'long-job-cancellation risk is required');
	assert.equal(cancellation.status, 'partial');

	const admission = cancellation.currentControls.find(
		({ id }) => id === 'bounded-spectral-edit-useful-binary',
	);
	assert.ok(admission, 'bounded spectral-edit useful-binary control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(
			admission.evidence.some(
				({ kind, path }) => kind === expected.kind && path === expected.path,
			),
			`spectral-edit admission needs ${expected.kind} evidence from ${expected.path}`,
		);
	}
});
