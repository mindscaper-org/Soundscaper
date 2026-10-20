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

const EXPECTED_EVIDENCE = [
	{ kind: 'implementation', path: 'src/common/editor/pcm-sink-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/pcm-sink.js' },
	{ kind: 'implementation', path: 'src/common/editor/render-capture-worklet.js' },
	{ kind: 'implementation', path: 'src/common/editor/engine/realtime-render-capture.ts' },
	{ kind: 'implementation', path: 'src/common/editor/engine/rendering.ts' },
	{ kind: 'test', path: 'tests/audio-editor-realtime-render-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-render-capture-worklet.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-pcm-sink.test.js' },
	{ kind: 'test', path: 'tests/audio-editor-realtime-stream-underrun.test.ts' },
] as const;

test('realtime render PCM admission retains its required control and runtime evidence', async () => {
	const matrix = JSON.parse(await readFile(
		new URL('../config/production-security-matrix.json', import.meta.url),
		'utf8',
	)) as SecurityMatrix;
	const cancellation = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	assert.ok(cancellation, 'long-job-cancellation risk is required');
	assert.equal(cancellation.status, 'partial');
	const admission = cancellation.currentControls.find(
		({ id }) => id === 'bounded-realtime-render-pcm',
	);
	assert.ok(admission, 'bounded realtime-render PCM control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(admission.evidence.some(
			({ kind, path }) => kind === expected.kind && path === expected.path,
		), `realtime-render admission needs ${expected.kind} evidence from ${expected.path}`);
	}

	const residual = cancellation.residualRisks.find(
		({ id }) => id === 'render-worker-resident-set-accounting',
	);
	assert.ok(residual, 'render and worker resident-set residual is required');
	assert.equal(residual.ownerMilestone, '2');
});
