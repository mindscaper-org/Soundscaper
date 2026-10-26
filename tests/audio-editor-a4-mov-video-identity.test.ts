/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_EDITOR_VIDEO_FILE_ACCEPT, isAudioEditorVideoFile } from '../src/common/editor/video-media.js';
import { resolveMediaImportVideoRoute } from '../src/common/editor/controller/import/internal/media-import-video-route.ts';
import { nativeQuickTimeAvFixture } from './helpers/native-quicktime-av-fixture.ts';

test('ordinary generic-MIME MOV reaches the existing audio/video container classifier', async () => {
	const file = nativeQuickTimeAvFixture();
	assert.equal(isAudioEditorVideoFile(file), true);
	assert.equal(await resolveMediaImportVideoRoute(file, isAudioEditorVideoFile(file)), true);
});

test('the existing video chooser admits the already-decodable QuickTime suffix', () => {
	assert.ok(AUDIO_EDITOR_VIDEO_FILE_ACCEPT.split(',').includes('.mov'));
});

test('proper MIME and audio-only QuickTime retain their existing routes', async () => {
	const video = nativeQuickTimeAvFixture('av', 'video/quicktime');
	assert.equal(await resolveMediaImportVideoRoute(video, isAudioEditorVideoFile(video)), true);
	const audio = nativeQuickTimeAvFixture('audio');
	assert.equal(await resolveMediaImportVideoRoute(audio, isAudioEditorVideoFile(audio)), false);
	for (const name of ['Recording.mp4', 'Recording.m4v', 'Recording.webm']) assert.equal(isAudioEditorVideoFile(new File([], name)), true);
	assert.equal(isAudioEditorVideoFile(new File([], 'Recording.wav', { type: 'audio/wav' })), false);
	assert.equal(isAudioEditorVideoFile(new File([], 'Unknown.video', { type: 'video/unknown' })), true);
});

test('MOV container route cancellation retains the exact caller reason', async () => {
	const abort = new AbortController(), reason = new DOMException('Retired MOV import.', 'AbortError'); abort.abort(reason);
	await assert.rejects(resolveMediaImportVideoRoute(nativeQuickTimeAvFixture(), true, abort.signal), error => error === reason);
});
