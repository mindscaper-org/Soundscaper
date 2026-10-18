/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface Evidence {
	readonly kind: string;
	readonly path: string;
}

interface SecurityBoundary {
	readonly id: string;
	readonly entryPoints: readonly string[];
	readonly evidence: readonly Evidence[];
}

interface SecurityControl {
	readonly id: string;
	readonly summary: string;
	readonly evidence: readonly Evidence[];
	readonly policyAuthority: string;
}

interface ResidualRisk {
	readonly id: string;
	readonly exposure: string;
	readonly requiredControl: string;
	readonly acceptanceCriteria: readonly string[];
}

interface SecurityRisk {
	readonly id: string;
	readonly boundaryIds: readonly string[];
	readonly status: string;
	readonly surfaceDisposition: string;
	readonly currentControls: readonly SecurityControl[];
	readonly residualRisks: readonly ResidualRisk[];
}

interface SecurityMatrix {
	readonly groundedAt: string;
	readonly boundaries: readonly SecurityBoundary[];
	readonly risks: readonly SecurityRisk[];
}

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('Freesound proxy security claims are bounded and retain deployment residuals', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8')) as SecurityMatrix;
	const boundaries = new Map(matrix.boundaries.map((boundary) => [boundary.id, boundary]));
	const risk = matrix.risks.find(({ id }) => id === 'freesound-proxy-boundary');

	assert.ok(matrix.groundedAt >= '2026-09-21');
	assert.ok(risk);
	assert.equal(risk.status, 'partial');
	assert.equal(risk.surfaceDisposition, 'conditional');
	assert.deepEqual(risk.boundaryIds, [
		'public-client-to-freesound-proxy',
		'authenticated-client-to-freesound-proxy',
		'freesound-upstream-to-proxy',
	]);

	for (const boundaryId of risk.boundaryIds) {
		const boundary = boundaries.get(boundaryId);
		assert.ok(boundary, boundaryId);
		assert.ok(boundary.entryPoints.some((path) => path.startsWith('functions/api/freesound/')));
		assert.ok(boundary.evidence.some(({ kind }) => kind === 'test'));
	}

	const control = risk.currentControls.find(({ id }) => id === 'bounded-freesound-read-proxy');
	assert.ok(control);
	assert.equal(control.policyAuthority, 'family-v1-active');
	for (const path of [
		'functions/api/freesound/_shared/contracts.ts',
		'functions/api/freesound/_shared/handlers.ts',
		'public/_routes.json',
		'tests/freesound-api-contract.test.ts',
		'tests/freesound-api-handlers.test.ts',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
	const oauthControl = risk.currentControls.find(({ id }) => id === 'bounded-freesound-oauth-media-proxy');
	assert.ok(oauthControl);
	assert.equal(oauthControl.policyAuthority, 'family-v1-active');
	for (const path of [
		'functions/api/freesound/_shared/oauth-handlers.ts',
		'functions/api/freesound/_shared/protected-handlers.ts',
		'desktop/freesound-integration.js',
		'tests/freesound-oauth-handlers.test.ts',
		'tests/freesound-protected-api.test.ts',
		'tests/desktop-freesound-integration.test.js',
	]) assert.ok(oauthControl.evidence.some((item) => item.path === path), path);

	assert.deepEqual(risk.residualRisks.map(({ id }) => id), [
		'freesound-proxy-deployment-rate-limiting',
		'freesound-preview-stream-lifecycle',
		'freesound-authenticated-media-lifecycle',
	]);
	for (const residual of risk.residualRisks) {
		assert.ok(residual.requiredControl.length > 0);
		assert.ok(residual.acceptanceCriteria.length > 0);
	}
});

test('Wrangler local secret files cannot be added accidentally', async () => {
	const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
	const ignoredEntries = new Set(gitignore.split(/\r?\n/u));

	assert.equal(ignoredEntries.has('.dev.vars'), true);
	assert.equal(ignoredEntries.has('.dev.vars.*'), true);
});
