/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffect } from '../src/common/editor/effects.js';
import { createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, type SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	createSoundscaperTrackDuplicateClipboardV8,
	normalizeSoundscaperTrackDuplicateClipboardV8,
	prepareCurrentSoundscaperTrackDuplicateCarrierV8,
	prepareSoundscaperTrackDuplicateCarrierV8,
} from '../src/soundscaper/editor-session-clipboard.ts';

for (const extraTrack of [
	createLabelTrack({ id: 'labels', name: 'Labels' }),
	{ id: 'video', name: 'Video', type: 'video', clipIds: [], locked: false },
]) {
	test(`track duplication ignores a ${extraTrack.type} track without an effect rack`, () => {
		const voice = createAudioTrack({
			id: 'voice', name: 'Voice', clipIds: [],
			effects: [createEffect('highpass', { id: 'voice-gain' })],
		});
		const project = createSoundscaperProject({
			tracks: [voice, extraTrack],
			sequences: [{
				id: 'main-sequence', rate: { num: 30, den: 1 },
				trackIds: ['voice', String(extraTrack.id)],
			}],
			primarySequenceId: 'main-sequence',
		} as never);

		const carrier = prepareCurrentSoundscaperTrackDuplicateCarrierV8(project, {
			sourceTrackId: 'voice', targetTrackId: 'voice-copy',
			effectIds: [{ sourceId: 'voice-gain', targetId: 'voice-copy-gain' }],
		});
		assert.deepEqual(carrier.effectIds, [
			{ sourceId: 'voice-gain', targetId: 'voice-copy-gain' },
		]);
		assert.equal(Object.isFrozen(carrier), true);
	});
}

test('track duplicate clipboard captures and normalizes detached immutable authority', () => {
	const project = clipboardProject();
	const captured = createSoundscaperTrackDuplicateClipboardV8(project, 'voice');
	const normalized = normalizeSoundscaperTrackDuplicateClipboardV8(structuredClone(captured));

	assert.deepEqual(normalized, captured);
	assert.notStrictEqual(normalized, captured);
	assert.equal(Object.isFrozen(captured), true);
	assert.equal(Object.isFrozen(captured.effectIds), true);
	assert.equal(Object.isFrozen(normalized), true);
	assert.equal(Object.isFrozen(normalized.effectIds), true);
});


test('track duplicate clipboard requires a fresh target track identity', () => {
	const project = clipboardProject();
	const captured = createSoundscaperTrackDuplicateClipboardV8(project, 'voice');
	for (const targetTrackId of ['voice', 'music']) {
		assert.throws(
			() => prepareSoundscaperTrackDuplicateCarrierV8(project, captured, {
				...duplicateRequest(), targetTrackId,
			}),
			/fresh target track identity/iu,
		);
	}
});

test('track duplicate clipboard requires one-to-one effect remapping', () => {
	const project = clipboardProject();
	for (const effectIds of [
		[
			{ sourceId: 'voice-highpass', targetId: 'copy-effect' },
			{ sourceId: 'voice-limiter', targetId: 'copy-effect' },
		],
	]) {
		assert.throws(
			() => prepareCurrentSoundscaperTrackDuplicateCarrierV8(project, {
				...duplicateRequest(), effectIds,
			}),
			/must be one-to-one/iu,
		);
	}
});

test('track duplicate clipboard refuses target effect identities already in the project', () => {
	const project = clipboardProject();
	const captured = createSoundscaperTrackDuplicateClipboardV8(project, 'voice');
	assert.throws(
		() => prepareSoundscaperTrackDuplicateCarrierV8(project, captured, {
			...duplicateRequest(),
			effectIds: [
				{ sourceId: 'voice-highpass', targetId: 'music-highpass' },
				{ sourceId: 'voice-limiter', targetId: 'copy-limiter' },
			],
		}),
		/already in use/iu,
	);
});

function clipboardProject(): SoundscaperProject {
	return createSoundscaperProject({
		id: 'clipboard-project', title: 'Clipboard project', revision: 3,
		now: '2026-09-30T12:00:00.000Z',
		tracks: [
			createAudioTrack({
				id: 'voice', name: 'Voice', clipIds: [],
				effects: [
					createEffect('highpass', { id: 'voice-highpass' }),
					createEffect('limiter', { id: 'voice-limiter' }),
				],
			}),
			createAudioTrack({
				id: 'music', name: 'Music', clipIds: [],
				effects: [createEffect('highpass', { id: 'music-highpass' })],
			}),
		],
		sequences: [{
			id: 'main-sequence', rate: { num: 30, den: 1 }, trackIds: ['voice', 'music'],
		}],
		primarySequenceId: 'main-sequence',
	} as never);
}

function duplicateRequest() {
	return {
		sourceTrackId: 'voice', targetTrackId: 'voice-copy',
		effectIds: [
			{ sourceId: 'voice-highpass', targetId: 'copy-highpass' },
			{ sourceId: 'voice-limiter', targetId: 'copy-limiter' },
		],
	};
}
