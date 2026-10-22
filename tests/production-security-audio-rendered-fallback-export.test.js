/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('role-defined audio rendered-fallback export stays private and narrowly qualified', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'audio-rendered-fallback-export',
	);
	assert.ok(control);
	assert.equal(
		projectDocuments?.currentControls.some(
			({ id }) => id === 'first-party-audio-effects-rendered-fallback-export',
		),
		false,
	);

	for (const path of [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-audio-rendered-fallback.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-audio.ts',
		'src/common/editor/controller/source/playback-project-service.ts',
		'src/common/editor/controller/document/project-admin-service.ts',
		'src/common/editor/controller/export/internal/audio/audio-rendered-fallback-export.ts',
		'src/common/editor/controller/export/internal/export-service.ts',
		'src/common/editor/app.js',
		'tests/audio-editor-audio-rendered-fallback-delivery-projection.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export.test.ts',
		'tests/audio-editor-audio-rendered-fallback-export-service.test.ts',
		'tests/audio-editor-project-fallback-integrity-audio-selection.test.ts',
		'tests/audio-editor-project-fallback-integrity-audio-provider.test.ts',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/production-security-audio-rendered-fallback-export.test.js',
	]) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
		assert.ok(control.evidence.some((item) => item.path === path), path);
	}
});
