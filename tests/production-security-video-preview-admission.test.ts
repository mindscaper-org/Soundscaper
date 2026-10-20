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

interface SecurityRisk {
	readonly id: string;
	readonly status: string;
	readonly currentControls: readonly SecurityControl[];
}

interface SecurityMatrix {
	readonly risks: readonly SecurityRisk[];
}

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

const EXPECTED_EVIDENCE = [
	{ kind: 'implementation', path: 'src/common/editor/video-preview-capture-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/video-media.js' },
	{ kind: 'implementation', path: 'src/common/editor/controller/import/internal/source-import.ts' },
	{ kind: 'test', path: 'tests/audio-editor-video-preview-capture-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-video-media.test.js' },
	{ kind: 'test', path: 'tests/audio-editor-source-import.test.ts' },
] as const;

test('disposable video-preview admission retains its required control and runtime evidence', async () => {
	const matrixText = await readFile(matrixUrl, 'utf8');
	const matrix = JSON.parse(matrixText) as SecurityMatrix;
	const parserBounds = matrix.risks.find(({ id }) => id === 'external-media-parser-bounds');
	assert.ok(parserBounds, 'external-media-parser-bounds risk is required');
	assert.equal(parserBounds.status, 'partial');

	const admission = parserBounds.currentControls.find(
		({ id }) => id === 'bounded-disposable-video-preview-capture',
	);
	assert.ok(admission, 'bounded disposable video-preview capture control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(
			admission.evidence.some(
				({ kind, path }) => kind === expected.kind && path === expected.path,
			),
			`video-preview admission needs ${expected.kind} evidence from ${expected.path}`,
		);
	}
});
