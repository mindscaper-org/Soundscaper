/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('legacy AUP evidence pins structural and block-materialization budgets', async () => {
	const matrix = await readMatrix();
	const projectDocuments = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	assert.ok(projectDocuments);
	assert.equal(projectDocuments.status, 'partial');
	assert.equal(projectDocuments.surfaceDisposition, 'conditional');

	const legacyAup = projectDocuments.currentControls.find(
		({ id }) => id === 'legacy-aup-xml-structural-budget',
	);
	assert.ok(legacyAup);
	for (const path of [
		'src/common/editor/aup-legacy-xml.ts',
		'src/common/editor/aup-legacy.js',
		'src/common/editor/controller/import/internal/project-import-service.ts',
		'tests/audio-editor-aup-legacy.test.js',
		'tests/audio-editor-aup-legacy-import-boundary.test.ts',
	]) assert.ok(legacyAup.evidence.some((item) => item.path === path));

	const blockBudget = projectDocuments.currentControls.find(
		({ id }) => id === 'legacy-aup-block-pcm-working-set-budget',
	);
	assert.ok(blockBudget);
	for (const path of [
		'src/common/editor/aup-legacy-block-budget.ts',
		'src/common/editor/aup-legacy.js',
		'src/common/editor/controller/import/internal/project-import-service.ts',
		'tests/audio-editor-aup-legacy-block-budget.test.ts',
		'tests/audio-editor-aup-legacy-block-compatibility.test.ts',
		'tests/audio-editor-aup-legacy.test.js',
		'tests/audio-editor-aup-legacy-import-boundary.test.ts',
	]) assert.ok(blockBudget.evidence.some((item) => item.path === path));

	const sharedBudget = projectDocuments.residualRisks.find(({ id }) => id === 'shared-project-parse-budget');
	const malformedCorpus = projectDocuments.residualRisks.find(({ id }) => id === 'malformed-project-corpus');
	assert.ok(sharedBudget);
	assert.ok(malformedCorpus);
});

test('desktop save admission evidence pins product-wide capacity before staging', async () => {
	const matrix = await readMatrix();
	const desktopWrite = matrix.risks.find(({ id }) => id === 'desktop-write-path-capabilities');
	assert.ok(desktopWrite);
	assert.equal(desktopWrite.status, 'partial');
	assert.equal(desktopWrite.surfaceDisposition, 'conditional');

	const admission = desktopWrite.currentControls.find(
		({ id }) => id === 'aggregate-save-capacity-and-disk-admission',
	);
	assert.ok(admission);
	for (const path of [
		'desktop/constants.js', 'desktop/preload.mjs',
		'desktop/save-targets.js', 'desktop/save-space.js',
		'tests/desktop-save-capacity.test.js', 'tests/desktop-save-space-exhaustion.test.js',
		'tests/desktop-protocol.test.js',
	]) assert.ok(admission.evidence.some((item) => item.path === path));

	assert.equal(desktopWrite.residualRisks.some(
		({ id }) => id === 'write-capacity-and-disk-admission',
	), false);
	assert.ok(desktopWrite.residualRisks.some(
		({ id }) => id === 'in-flight-write-cancellation',
	));
});

async function readMatrix() {
	return JSON.parse(await readFile(matrixUrl, 'utf8'));
}
