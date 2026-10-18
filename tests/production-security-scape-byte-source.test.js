/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const referenceScaleTestUrl = new URL('./desktop-scape-sparse-full-import-integration.test.ts', import.meta.url);

test('production evidence pins bounded random-access .scape admission', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const matchingControls = matrix.risks.flatMap((risk) => risk.currentControls
		.filter(({ id }) => id === 'bounded-random-access-archive-reading')
		.map((control) => ({ riskId: risk.id, control })));
	assert.equal(matchingControls.length, 1);
	assert.equal(matchingControls[0].riskId, 'scape-archive-expansion');
	const { control } = matchingControls[0];
	assert.ok(control);
	const packagedOpenControl = matrix.risks.find(({ id }) => id === 'scape-archive-expansion')?.currentControls
		.find(({ id }) => id === 'packaged-linux-x64-current-schema-scape-open');
	assert.ok(packagedOpenControl);
	for (const path of [
		'desktop/scape-open-smoke.js',
		'desktop/desktop-smoke.js',
		'desktop/main.mjs',
		'scripts/lib/desktop-scape-open-smoke.mjs',
		'scripts/desktop-scape-open-smoke.mjs',
		'tests/desktop-scape-open-smoke-probe.test.js',
		'tests/desktop-scape-open-smoke-wiring.test.js',
		'tests/desktop-scape-open-smoke.test.js',
		'tests/desktop-scape-open-workflow.test.js',
		'package.json',
		'.github/workflows/desktop-preview.yml',
	]) {
		assert.ok(packagedOpenControl.evidence.some((item) => item.path === path),
			`Missing packaged Scape-open evidence from ${path}`);
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
	}
	const packagedReopenControl = matrix.risks.find(({ id }) => id === 'scape-archive-expansion')?.currentControls
		.find(({ id }) => id === 'packaged-linux-x64-current-schema-scape-reopen');
	assert.ok(packagedReopenControl);
	for (const path of [
		'desktop/scape-reopen-smoke.js',
		'desktop/desktop-smoke.js',
		'src/common/editor/controller/document/internal/project/project-bootstrap-service.ts',
		'src/common/editor/controller/document/internal/project/project-session-service.ts',
		'src/common/editor/controller/document/project-switch-service.ts',
		'scripts/lib/desktop-scape-reopen-smoke.mjs',
		'scripts/desktop-scape-open-smoke.mjs',
		'tests/desktop-scape-reopen-smoke-probe.test.js',
		'tests/desktop-scape-reopen-smoke.test.js',
		'tests/desktop-scape-open-workflow.test.js',
		'package.json',
		'.github/workflows/desktop-preview.yml',
	]) {
		assert.ok(packagedReopenControl.evidence.some((item) => item.path === path),
			`Missing packaged Scape-reopen evidence from ${path}`);
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
	}
	const capacityControl = matrix.risks.find(({ id }) => id === 'scape-archive-expansion')?.currentControls
		.find(({ id }) => id === 'point-in-time-import-capacity-admission');
	assert.ok(capacityControl);
	for (const path of [
		'desktop/constants.js',
		'desktop/protocol.js',
		'desktop/read-selection-service.js',
		'src/common/editor/desktop-scape-archive-byte-source.ts',
		'src/common/editor/desktop-read-profile.ts',
		'src/common/editor/file-service.js',
		'src/common/editor/scape-abort.ts',
		'src/common/editor/scape-archive-byte-source.ts',
		'src/common/editor/scape-archive-layout-witness.ts',
		'src/common/editor/scape-archive-layout.ts',
		'src/common/editor/scape-archive-reader.ts',
		'src/common/editor/scape-project-input.ts',
		'src/common/editor/ui/workspace/desktop-project-file-routing.ts',
		'tests/audio-editor-scape-archive-byte-source.test.ts',
		'tests/audio-editor-desktop-project-file-routing.test.ts',
		'tests/audio-editor-desktop-scape-archive-byte-source.test.ts',
		'tests/audio-editor-file-service-scape-ranges.test.ts',
		'tests/audio-editor-scape-project-byte-source.test.ts',
		'tests/desktop-read-selection-service.test.js',
		'tests/desktop-scape-range-protocol.test.js',
		'tests/desktop-scape-sparse-full-import-integration.test.ts',
		'tests/desktop-scape-sparse-range-integration.test.ts',
		'tests/helpers/sparse-scape-zip64-fixture.ts',
	]) {
		assert.ok(control.evidence.some((item) => item.path === path), `Missing evidence from ${path}`);
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
	}
	const packageMetadata = JSON.parse(await readFile(packageUrl, 'utf8'));
	assert.equal(
		packageMetadata.scripts?.['test:reference:scape-8gib'],
		'node --import tsx --import ./scripts/node-style-asset-loader.mjs --test tests/desktop-scape-sparse-full-import-integration.test.ts',
	);
	const referenceScaleTest = await readFile(referenceScaleTestUrl, 'utf8');
	assert.match(referenceScaleTest, /REFERENCE_SCALE_NPM_LIFECYCLE = 'test:reference:scape-8gib'/u);
	assert.match(referenceScaleTest, /process\.env\.npm_lifecycle_event === REFERENCE_SCALE_NPM_LIFECYCLE/u);
	assert.match(referenceScaleTest, /process\.env\[REFERENCE_SCALE_ENVIRONMENT\] === '1'/u);
	assert.match(referenceScaleTest, /skip: RUN_REFERENCE_SCALE_GATE \? false : REFERENCE_SCALE_SKIP_MESSAGE/u);
	assert.match(referenceScaleTest, /EXACT_REQUIRED_FREE_BYTES = 9_448_923_946/u);
	assert.match(referenceScaleTest, /'capacity-estimated',[\s\S]*'media-write-began'/u);
	for (const path of [
		'tests/audio-editor-scape-streaming-video.test.ts',
		'tests/desktop-scape-sparse-range-integration.test.ts',
	]) {
		const routineTest = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
		assert.doesNotMatch(routineTest, /SOUNDSCAPER_RUN_REFERENCE_SCAPE_8GIB/u);
	}
	const integrityRisk = matrix.risks.find(({ id }) => id === 'scape-archive-structure-integrity');
	const integrityControl = integrityRisk?.currentControls
		.find(({ id }) => id === 'canonical-entry-and-content-integrity');
	assert.ok(integrityControl);
	for (const path of [
		'src/common/editor/scape-archive-reader.ts',
		'tests/audio-editor-scape-streaming-video.test.ts',
	]) {
		assert.ok(integrityControl.evidence.some((item) => item.path === path), `Missing integrity evidence from ${path}`);
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
	}
});
