/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('rendered fallback uses selected browser-native encoding or fails closed', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'video-rendered-fallback-export',
	);
	assert.ok(control);
	for (const path of [
		'src/common/editor/project-feature-video-rendered-fallback.ts',
		'src/common/editor/project-fallback-integrity-video.ts',
		'src/common/editor/controller/export/internal/video/video-rendered-fallback-export.ts',
		'src/common/editor/controller/export/internal/video/video-export-service.ts',
		'src/common/editor/video-delivery-encoder-tier.ts',
		'src/common/editor/video-keyframe-video-encoder.ts',
		'src/common/editor/video-keyframe-mediabunny-execution.ts',
		'tests/audio-editor-video-rendered-fallback-export.test.ts',
		'tests/audio-editor-mixed-rendered-fallback-video-export.test.ts',
		'tests/audio-editor-video-delivery-encoder-tier.test.ts',
		'tests/audio-editor-video-keyframe-mediabunny-execution.test.ts',
	]) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
		assert.ok(control.evidence.some((item) => item.path === path), path);
	}
	assert.equal(control.evidence.some(({ path }) => path === 'src/common/editor/ffmpeg.js'), false);
});
