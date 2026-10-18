/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('security policy bounds owning-family-v1 JSON admission and leaves opaque custody uninterpreted', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'scape-archive-structure-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'bounded-current-schema-opaque-binary-codec',
	);
	assert.ok(control);
	for (const path of [
		'src/common/editor/scape-project-document.ts',
		'src/common/editor/scape-project-json-preflight.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-project.js',
		'tests/audio-editor-scape-project-document.test.ts',
		'tests/audio-editor-scape-project.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
});
