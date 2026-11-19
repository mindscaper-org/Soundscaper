/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('menu-opened panel and dialog helpers keep their deferred surface owner', () => {
	for (const name of [
		'clip-spreadsheet/ClipSpreadsheetPanel.tsx', 'clip-spreadsheet/clipboard.ts',
		'clip-spreadsheet/paste.ts', 'clip-spreadsheet/clip-spreadsheet.css',
		'AdmMetadataFields.tsx', 'BextMetadataFields.tsx',
		'adm-metadata-editor-model.ts', 'bext-metadata-editor-model.ts',
		'desktop-speed-warmup.ts', 'export-channel-matrix.ts',
		'export-dialog-output-options.ts', 'export-dialog-initial-settings.ts',
		'use-export-dialog-output.ts',
		'label-export-dialog-model.ts', 'delivery-batch-dialog-model.ts',
		'audio-warp-dialog-model.ts', 'take-comp-dialog-model.ts',
		'video-keyframe-dialog-input.ts', 'video-retime-exact-map-input.ts',
		'ParametricEqNumericInput.jsx', 'useParametricEqSpectrum.ts',
		'skins/SkinCarousel.tsx', 'skins/SkinPreferences.tsx', 'skins/appearance-previews.ts',
		'workspace/freesound-media-url.ts',
	]) {
		const path = `src/common/editor/ui/${name}`;
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-surfaces', path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-optional-surfaces', path);
	}
});

test('import-only preparation helpers load with the deferred import service', () => {
	for (const name of [
		'raw-pcm-import', 'internal/clip-spreadsheet-paste-service',
		'internal/prepare-clip-spreadsheet-source', 'internal/import-result-warnings',
		'internal/incremental-wav-import-service', 'internal/wav-import-metadata',
		'internal/wav-import-routing', 'internal/legacy-audacity-project-import',
		'internal/legacy-aup-project-persistence', 'internal/freesound-import-download',
		'internal/linked-media/linked-wav-import-service',
		'internal/linked-media/linked-audio-import-admission',
		'internal/dawproject/dawproject-import-compressed',
		'internal/dawproject/dawproject-export-audio',
	]) {
		const path = `src/common/editor/controller/import/${name}.ts`;
		assert.equal(chunkGroupForModulePath(path), 'editor-import-admission', path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-import-admission', path);
	}
});

test('offline video export helpers load with export rather than the preview shell', () => {
	for (const name of [
		'video-keyframe-offline-html-video-source-admission', 'video-keyframe-offline-html-video-source-resolver',
		'video-keyframe-offline-rgba-admission', 'video-keyframe-offline-rgba-source',
		'video-keyframe-offline-rgba-renderer', 'video-keyframe-offline-video-export-admission',
		'video-keyframe-offline-video-export-sources', 'video-keyframe-offline-video-export-encoder',
		'video-keyframe-offline-video-export-runner', 'video-keyframe-offline-video-export',
	]) {
		const path = `src/common/editor/ui/${name}.ts`;
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-export', path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-optional-export', path);
	}
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/workspace/VideoPreviewPanel.jsx'), 'editor-shell');
});

test('repeated sound analysis and its FFT implementation stay deferred', () => {
	for (const path of [
		'src/common/editor/repeated-sound-correlation.ts',
		'src/common/editor/controller/analysis/internal/repeated-sound-service.ts',
	]) assert.equal(chunkGroupForModulePath(path), 'editor-optional-execution', path);
});

test('shared macro messages and project limits retain their narrow existing owners', () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/macro-script/protocol.ts'), 'editor-domain');
	assert.equal(chunkGroupForModulePath('src/common/project-size-limits.ts'), 'project-interchange-foundations');
});
