/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('desktop read capability behavior remains verified for its current surface', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const desktopRead = matrix.risks.find(({ id }) => id === 'desktop-read-path-capabilities');
	assert.ok(desktopRead);

	const rendererOwnedRead = desktopRead.currentControls.find(
		({ id }) => id === 'renderer-document-owned-read-lifecycle',
	);
	assert.ok(rendererOwnedRead);
	for (const path of [
		'desktop/constants.js',
		'desktop/file-capabilities.js',
		'desktop/file-associations.js',
		'desktop/main.mjs',
		'desktop/read-capability-admission.js',
		'desktop/read-selection-service.js',
		'desktop/renderer-save-owner.js',
		'desktop/protocol.js',
		'tests/desktop-file-association-delivery.test.js',
		'tests/desktop-read-capability-ownership.test.js',
		'tests/desktop-read-selection-service.test.js',
		'tests/desktop-renderer-save-owner.test.js',
		'tests/desktop-scape-read-capabilities.test.js',
		'tests/desktop-project-library-packaging.test.js',
		'tests/desktop-protocol.test.js',
		'tests/desktop-save.test.js',
	]) assert.ok(rendererOwnedRead.evidence.some((item) => item.path === path));

	const leasedRangeRead = desktopRead.currentControls.find(
		({ id }) => id === 'serialized-range-request-lifecycle',
	);
	assert.ok(leasedRangeRead);
	for (const path of [
		'desktop/constants.js',
		'desktop/file-capabilities.js',
		'desktop/preload.mjs',
		'desktop/protocol.js',
		'desktop/read-capability-admission.js',
		'src/common/editor/desktop-scape-archive-byte-source.ts',
		'src/common/editor/desktop-read-profile.ts',
		'src/common/editor/file-service.js',
		'src/common/editor/scape-abort.ts',
		'src/common/editor/scape-archive-byte-source.ts',
		'src/common/editor/ui/workspace/AudioEditorWorkspace.jsx',
		'src/common/editor/ui/workspace/desktop-project-file-routing.ts',
		'src/common/editor/ui/workspace/useDesktopEditorBridge.js',
		'tests/audio-editor-app-modules.test.js',
		'tests/audio-editor-desktop-project-file-routing.test.ts',
		'tests/audio-editor-desktop-scape-archive-byte-source.test.ts',
		'tests/audio-editor-file-service-scape-ranges.test.ts',
		'tests/desktop-preload-read-descriptors.test.js',
		'tests/desktop-read-capability-leases.test.js',
		'tests/desktop-protocol.test.js',
		'tests/desktop-scape-range-protocol.test.js',
		'tests/desktop-scape-read-capabilities.test.js',
	]) assert.ok(leasedRangeRead.evidence.some((item) => item.path === path));

	const linkedVideoPlayback = desktopRead.currentControls.find(
		({ id }) => id === 'owner-scoped-linked-video-playback-range-lifecycle',
	);
	assert.ok(linkedVideoPlayback);
	for (const path of [
		'desktop/linked-video-locator-ipc.js',
		'desktop/read-capability-admission.js',
		'desktop/read-capability-range-stream.js',
		'src/common/editor/storage/desktop-linked-video-range-reader.ts',
		'src/common/editor/storage/linked-video-original-resolver.ts',
		'tests/desktop-linked-video-playback-capability.test.js',
		'tests/desktop-linked-video-playback-locator.test.ts',
		'tests/audio-editor-desktop-linked-video-playback-port.test.ts',
		'tests/audio-editor-linked-video-playback-resolver.test.ts',
	]) assert.ok(linkedVideoPlayback.evidence.some((item) => item.path === path));

	const linkedAudioRange = desktopRead.currentControls.find(
		({ id }) => id === 'owner-scoped-linked-audio-range-lifecycle',
	);
	assert.ok(linkedAudioRange);
	for (const path of [
		'desktop/linked-original-locator-validation.ts',
		'desktop/linked-video-locator-ipc.js',
		'desktop/read-capability-admission.js',
		'desktop/read-capability-range-stream.js',
		'desktop/read-capability-support.js',
		'src/common/editor/aiff-pcm-chunk-reader.ts',
		'src/common/editor/desktop-linked-audio-range-adapter.ts',
		'src/common/editor/storage/desktop-linked-original-range-reader.ts',
		'src/common/editor/storage/linked-audio-original-source-reader.ts',
		'src/common/editor/storage/linked-original-range-lease.ts',
		'tests/audio-editor-aiff-pcm-chunk-reader.test.ts',
		'tests/desktop-linked-audio-range-capability.test.js',
		'tests/audio-editor-desktop-linked-audio-range-source.test.ts',
		'tests/audio-editor-linked-audio-range-source-reader.test.ts',
	]) assert.ok(linkedAudioRange.evidence.some((item) => item.path === path));

	assert.equal(desktopRead.residualRisks.some(({ id }) => id === 'read-capability-owner-lifecycle'), false);
	const boundedMaterialization = desktopRead.currentControls.find(
		({ id }) => id === 'bounded-abortable-renderer-read-materialization',
	);
	assert.ok(boundedMaterialization);
	for (const path of [
		'desktop/constants.js',
		'desktop/file-capabilities.js',
		'desktop/preload.mjs',
		'desktop/protocol.js',
		'src/common/editor/desktop-read-profile.ts',
		'src/common/editor/desktop-read-materialization.ts',
		'src/common/editor/file-service.js',
		'src/common/editor/platform/bounded-transfer.ts',
		'src/common/editor/ui/workspace/AudioEditorWorkspace.jsx',
		'src/common/editor/ui/workspace/ProjectBinPanel.jsx',
		'src/common/editor/ui/workspace/useDesktopEditorBridge.js',
		'tests/audio-editor-app-modules.test.js',
		'tests/audio-editor-desktop-project-file-routing.test.ts',
		'tests/audio-editor-desktop-read-materialization.test.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/desktop-preload-read-descriptors.test.js',
		'tests/desktop-read-capability-ownership.test.js',
		'tests/desktop-protocol.test.js',
	]) assert.ok(boundedMaterialization.evidence.some((item) => item.path === path));
	assert.equal(desktopRead.surfaceDisposition, 'verified-current-surface');
	assert.deepEqual(desktopRead.residualRisks, []);
});
