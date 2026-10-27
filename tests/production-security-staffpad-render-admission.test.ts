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
	{ kind: 'implementation', path: 'src/common/editor/clip-time-pitch-render-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/clip-time-pitch-cache.js' },
	{ kind: 'implementation', path: 'src/common/editor/staffpad/parameters.js' },
	{ kind: 'implementation', path: 'src/common/editor/staffpad/client.js' },
	{ kind: 'implementation', path: 'src/common/editor/staffpad/worker.js' },
	{ kind: 'implementation', path: 'src/common/editor/staffpad/runtime.js' },
	{ kind: 'document', path: 'src/common/editor/staffpad/source-manifest.json' },
	{ kind: 'test', path: 'tests/audio-editor-clip-time-pitch-render-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-clip-time-pitch-cache.test.js' },
	{ kind: 'audit', path: 'scripts/audit-staffpad-wasm.mjs' },
] as const;

test('StaffPad clip-cache render admission retains its required control and runtime evidence', async () => {
	const matrixText = await readFile(matrixUrl, 'utf8');
	const matrix = JSON.parse(matrixText) as SecurityMatrix;
	const cancellation = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	assert.ok(cancellation, 'long-job-cancellation risk is required');
	assert.equal(cancellation.status, 'partial');

	const admission = cancellation.currentControls.find(
		({ id }) => id === 'serialized-staffpad-clip-render-admission',
	);
	assert.ok(admission, 'serialized StaffPad clip render admission control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(
			admission.evidence.some(
				({ kind, path }) => kind === expected.kind && path === expected.path,
			),
			`StaffPad render admission needs ${expected.kind} evidence from ${expected.path}`,
		);
	}
});
