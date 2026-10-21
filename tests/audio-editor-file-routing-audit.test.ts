/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { isWorkspaceImportFile, partitionWorkspaceFiles, WORKSPACE_IMPORT_FILE_ACCEPT } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { isStreamedAudioImportFile } from '../src/common/editor/streamed-audio-import-file.ts';
import { isLegacyBlockFile, isWavFile } from '../src/common/editor/controller/shared/app-helpers.ts';
import { maintainedAiffMimeType } from '../src/common/editor/controller/import/internal/aiff-file-identity.ts';
import { createProjectImportService } from '../src/common/editor/controller/import/internal/project-import-service.ts';
import { createProjectImportServiceRuntime } from '../src/common/editor/controller/import/internal/project-import-service-runtime.ts';
import { createFixture, file } from './audio-editor-project-import-service-fixture.ts';

test('AIFF-C is selectable through the ordinary import menu without an OS MIME association', () => {
	assert.ok(WORKSPACE_IMPORT_FILE_ACCEPT.split(',').includes('.aifc'));
	assert.equal(isWorkspaceImportFile(new File([], 'recording.aifc')), true);
});

test('desktop SESX drops follow the project route', () => {
	const session = new File(['<sesx/>'], 'session.SESX');
	assert.deepEqual(partitionWorkspaceFiles([session]).projects, [session]);
});

test('MIME parameters retain WAV, compressed audio, caption and CUE routes', () => {
	assert.equal(isWavFile(new File([], 'recording', { type: 'audio/wav; codecs=1' })), true);
	assert.equal(isStreamedAudioImportFile(new File([], 'recording', { type: 'audio/mpeg; codecs=mp3' })), true);
	const caption = new File([], 'captions', { type: 'text/vtt; charset=utf-8' });
	assert.equal(isWorkspaceImportFile(caption), true);
	assert.deepEqual(partitionWorkspaceFiles([caption]).labels, [caption]);
	const cue = new File([], 'chapters', { type: 'application/x-cue; charset=utf-8' });
	assert.deepEqual(partitionWorkspaceFiles([cue]).cues, [cue]);
});

test('generic MIME types do not bypass the maintained AIFF PCM reader', () => {
	assert.equal(maintainedAiffMimeType(new File([], 'surround.aiff', { type: 'application/octet-stream' })), 'audio/aiff');
});

test('AUF companion blocks are kept out of independent audio import', () => {
	assert.equal(isLegacyBlockFile(new File([], 'e0000.AUF')), true);
});

test('a failed first-use import module can be retried after connectivity recovers', async () => {
	const fixture = createFixture(); let attempts = 0;
	const service = createProjectImportService(fixture.runtime as unknown as Parameters<typeof createProjectImportService>[0], async () => {
		if (++attempts === 1) throw new Error('offline');
		return { createProjectImportServiceRuntime };
	});
	await assert.rejects(service.importFile(file('voice.wav')), /offline/u);
	await service.importFile(file('voice.wav'));
	assert.equal(attempts, 2);
	assert.equal(fixture.commands.length, 1);
});
