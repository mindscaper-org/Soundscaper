/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('project publication evidence keeps canonical admission distinct from backend capacity', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	assert.ok(projectDocuments);
	const admission = projectDocuments.currentControls.find(
		({ id }) => id === 'maintained-project-publication-admission',
	);
	const accounting = projectDocuments.residualRisks.find(
		({ id }) => id === 'project-publication-capacity-accounting',
	);
	assert.ok(admission);
	for (const path of [
		'src/common/editor/project-publication-admission.ts', 'src/common/editor/storage.js', 'src/common/editor/types.ts',
		'src/common/editor/controller/document/project-save-service.ts',
		'src/common/editor/controller/shared/storage-capacity-runtime.ts',
		'src/common/editor/controller/shared/storage-capacity-service.ts', 'src/common/editor/app.js',
		'tests/audio-editor-project-publication-admission.test.ts',
		'tests/audio-editor-project-store-publication-admission.test.ts',
		'tests/audio-editor-project-save-publication-admission.test.ts',
		'tests/audio-editor-controller-disposal.test.js', 'tests/audio-editor-controller.test.js',
		'tests/audio-editor-storage-capacity-runtime.test.ts',
		'tests/audio-editor-storage-capacity-service.test.ts',
	]) assert.ok(admission.evidence.some((item) => item.path === path), path);
	assert.ok(accounting);
});
