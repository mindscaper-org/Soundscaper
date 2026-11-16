/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranscriptEditingActions } from '../src/common/editor/controller/composition/internal/transcript-editing-actions.ts';
import { createAssistanceTranscriptBodyPublicationV1 } from '../src/common/editor/assistance/transcript-body-publication-v1.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory as createEditorHistory, executeSoundscaperProjectCommand as executeEditorCommand, undoSoundscaperProjectCommand as undoEditorCommand, redoSoundscaperProjectCommand as redoEditorCommand } from '../src/soundscaper/editor-project-history.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

function fixture(twoTracks = false) {
	const publication = createAssistanceTranscriptBodyPublicationV1({ assetId: 'transcript-a',
		review: { kind: 'transcript', language: 'en', segments: [{ startSeconds: 0, endSeconds: 3,
			text: 'One two three.', speaker: null, words: [
				{ text: 'One', startSeconds: 0, endSeconds: 1, confidence: null },
				{ text: 'two', startSeconds: 1, endSeconds: 2, confidence: null },
				{ text: 'three.', startSeconds: 2, endSeconds: 3, confidence: null },
			] }] },
		selectedMedia: { sampleRate: 48_000, sourceVideoTimingSha256: null, selectionFence: {
			schemaFamily: 'soundscaper', schemaVersion: 1, projectId: 'project', revision: 0,
			sequenceId: 'main', occurrenceIds: ['clip'], sourceId: 'source', sourceSha256: 'ab'.repeat(32),
			sourceStartFrame: 0, sourceEndFrame: 144_000,
			linkMembershipSha256: 'cd'.repeat(32), timingAuthoritySha256: 'ef'.repeat(32),
		} }, model: { modelId: 'parakeet', artifactSha256s: ['12'.repeat(32)] }, recipe: { id: 'speech-transcript', version: 1 } });
	const source = createAudioSource({ id: 'source', name: 'Speech', storageKey: 'source',
		contentSha256: 'ab'.repeat(32), sampleRate: 48_000, frameCount: 144_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0,
		durationFrames: 144_000, sourceStartFrame: 0, sourceDurationFrames: 144_000 });
	const project = createSoundscaperProject({ id: 'project', sampleRate: 48_000,
		sources: [source], clips: [clip, ...(twoTracks ? [{ ...clip, id: 'copy' }] : [])],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] }),
			...(twoTracks ? [createAudioTrack({ id: 'track-b', clipIds: ['copy'] })] : []),
			{ id: 'transcript-track', type: 'label', name: 'Transcript', labels: [], opaqueExtensions: {
				'org.soundscaper.assistance-transcript-v1': { schemaVersion: 1, assetId: publication.reference.id },
			} }], assistanceAssets: [publication.reference],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['track', ...(twoTracks ? ['track-b'] : []), 'transcript-track'] }], primarySequenceId: 'main' });
	let history = createEditorHistory(project);
	const state = { readOnly: false };
	let body: unknown = new Blob([Uint8Array.from(publication.bytes)]);
	let loadBody = () => body;
	const commands: AudioEditorCommand[] = [];
	const actions = createTranscriptEditingActions({ state, getProject: () => history.present,
		store: { loadMediaAsset: () => loadBody() }, commit: command => {
			commands.push(command); history = executeEditorCommand(history, command);
		} });
	return { actions, state, commands, get history() { return history; }, set history(value) { history = value; },
		corrupt: () => { body = new Blob(['{}']); }, deferBody: () => {
			let release!: () => void;
			const pending = new Promise<unknown>(resolve => { release = () => resolve(body); });
			loadBody = () => pending;
			return release;
		} };
}

test('deleting a transcript word ripples audio once and undo/redo restores both projections', async () => {
	const f = fixture();
	const before = await f.actions.read('project');
	assert.deepEqual(before.words.map(word => word.text), ['One', 'two', 'three.']);
	await f.actions.remove('project', before.revision, [before.words[1]!.id]);
	assert.equal(f.commands.length, 1);
	const after = await f.actions.read('project');
	assert.deepEqual(after.words.map(word => [word.text, word.startFrame]), [['One', 0], ['three.', 48_000]]);
	assert.equal(Math.max(...resolveRuntimeProjectProjection(f.history.present).clips.map(clip => clip.timelineEndFrame)), 96_000);
	f.history = undoEditorCommand(f.history);
	assert.deepEqual((await f.actions.read('project')).words.map(word => word.text), ['One', 'two', 'three.']);
	f.history = redoEditorCommand(f.history);
	assert.deepEqual((await f.actions.read('project')).words.map(word => word.text), ['One', 'three.']);
});

test('corrupt bodies, stale selections, unknown words and read-only documents cannot delete audio', async () => {
	const f = fixture(), document = await f.actions.read('project');
	await assert.rejects(f.actions.remove('project', document.revision, ['forged-word']), /unavailable/iu);
	f.state.readOnly = true;
	await assert.rejects(f.actions.remove('project', document.revision, [document.words[0]!.id]), /read-only/iu);
	f.state.readOnly = false;
	await assert.rejects(f.actions.remove('project', document.revision + 1, [document.words[0]!.id]), /no longer matches/iu);
	f.corrupt();
	await assert.rejects(f.actions.read('project'), /integrity/iu);
	assert.equal(f.commands.length, 0);
});

test('a text selection across overlapping tracks deletes only the selected passage on each track', async () => {
	const f = fixture(true), document = await f.actions.read('project');
	const selected = document.words.filter(word => word.trackId === 'track' ? word.text === 'three.' : word.text === 'One');
	await f.actions.remove('project', document.revision, selected.map(word => word.id));
	const after = await f.actions.read('project');
	assert.deepEqual(after.words.filter(word => word.trackId === 'track').map(word => word.text), ['One', 'two']);
	assert.deepEqual(after.words.filter(word => word.trackId === 'track-b').map(word => word.text), ['two', 'three.']);
	assert.equal(f.commands.length, 1);
});

test('an asynchronous read tolerates selection changes and refuses changed transcript geometry', async () => {
	const f = fixture(), release = f.deferBody();
	const reading = f.actions.read('project');
	f.history = executeEditorCommand(f.history, { type: 'selection/set', startFrame: 48_000, endFrame: 96_000,
		trackIds: ['track'], clipIds: ['clip'], frequencyRange: null });
	release();
	assert.equal((await reading).words.length, 3);
	const changed = fixture(), releaseChanged = changed.deferBody();
	const stale = changed.actions.read('project');
	changed.history = executeEditorCommand(changed.history, { type: 'track/update', trackId: 'track', changes: { locked: true } });
	releaseChanged();
	await assert.rejects(stale, /audio changed/iu);
});
