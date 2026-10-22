/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('desktop project-library security is product-isolated at family v1', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const boundary = matrix.boundaries.find(({ id }) => id === 'electron-main-to-shared-project-library');
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'fenced-current-schema-project-catalog-publication',
	);

	assert.ok(boundary);
	assert.ok(risk);
	assert.equal(risk.status, 'partial');
	assert.ok(control);
	assert.equal(control.policyAuthority, 'family-v1-active');
	for (const { path } of control.evidence) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
	}
});

test('retired cross-product package controls cannot authorize the baseline', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	for (const id of [
		'packaged-linux-x64-source-free-project-library-handoff',
		'packaged-linux-x64-source-bearing-project-library-handoff',
		'chromium-scape-mixed-media-handoff',
	]) {
		const control = risk.currentControls.find((candidate) => candidate.id === id);
		assert.equal(control?.policyAuthority, 'historical-provenance-only', id);
		assert.equal(
			control.historicalPreFreezeNarrative?.status,
			'provenance-only-not-runtime-authority',
		);
	}
});
