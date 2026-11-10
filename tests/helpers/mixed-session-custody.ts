/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, type SoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { resolveRuntimeProjectProjection } from '../../src/common/editor/runtime-clip-projection.ts';
import { clipPropertiesMediaRange } from '../../src/common/editor/ui/inspector/clip-properties-media-range.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
export const MIXED_SESSION_CASES = [
	{ action: 'duplicate-clip', tempo: 96, split: .36 }, { action: 'ripple-delete', tempo: 104, split: .43 },
	{ action: 'insert-paste', tempo: 112, split: .51 }, { action: 'delete-undo', tempo: 88, split: .29 },
	{ action: 'trim-redo', tempo: 124, split: .62 }, { action: 'duplicate-track', tempo: 90, split: .47 },
	{ action: 'mute-solo', tempo: 118, split: .39 }, { action: 'reverse-invert', tempo: 132, split: .56 },
	{ action: 'second-split', tempo: 76, split: .67 }, { action: 'accent-delete-undo', tempo: 108, split: .33 },
] as const;
export type MixedSessionCase = typeof MIXED_SESSION_CASES[number];
export const SESSION_FRAMES = 288_000;
export const SOURCE_IN = 4800;
export const ENVELOPE = [{ frame: 0, value: 1 }, { frame: 69_120, value: .8 },
	{ frame: 204_480, value: 1.2 }, { frame: SESSION_FRAMES, value: 1 }];

export async function mixedSessionCustody(context: TestContext, row: MixedSessionCase) {
	const indexedDB = createInstrumentedIndexedDB();
	const initial = await session(context, indexedDB);
	const { controller, store } = initial;
	const source = createAudioSource({ id: 'recording', name: 'Long voice.wav', sampleRate: 48_000, channelCount: 2, frameCount: 384_000 });
	const pcm = [new Float32Array(source.frameCount).fill(.25), new Float32Array(source.frameCount).fill(-.125)];
	const writer = await store.beginSourceWrite(source.storageKey, source);
	for (let offset = 0; offset < source.frameCount; offset += 65_536) await writer.write(pcm.map(channel => channel.subarray(offset, offset + 65_536)));
	await writer.commit();
	const project = createSoundscaperProject({ id: `mixed-${row.action}`, sources: [source],
		tracks: [createAudioTrack({ id: 'empty', name: 'Track 1' }), createAudioTrack({ id: 'voice', name: 'Long voice', clipIds: ['phrase'] })],
		clips: [createAudioClip({ id: 'phrase', sourceId: source.id, title: source.name, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })] });
	await store.saveProject(project); await controller.actions.project.open(project);
	for (const [field, value] of [['sourceInFrame', SOURCE_IN], ['durationFrame', SESSION_FRAMES]] as const) {
		const current = snapshot(controller.project);
		const clip = resolveRuntimeProjectProjection(current).clips.find(clip => clip.id === 'phrase'); assert.ok(clip?.kind === 'audio');
		await controller.actions.clipSourcePreview.trim(clip.id, clipPropertiesMediaRange(clip, source.frameCount, field, value, { project: current, source }));
	}
	await controller.actions.clip.update('phrase', { gain: 10 ** (-2 / 20), fadeInFrames: 4800, fadeOutFrames: 9600, envelope: ENVELOPE });
	await controller.actions.clip.toggleStretchToTempo('phrase');
	const split = Math.round(SESSION_FRAMES * row.split);
	await controller.actions.timeline.setExactSelection(split, split, { trackIds: ['voice'] });
	await controller.actions.transport.seek(split); await controller.actions.edit.split();
	await controller.actions.edit.commit({ type: 'automation-lane/set', laneId: 'gain-ride', expected: null, lane: {
		id: 'gain-ride', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points: [{ id: 'ride-start', position: 0, value: 1 },
			{ id: 'ride-later', position: 48_000, value: .75 + (row.tempo % 3 - 1) / 100 }], segments: [{ kind: 'linear' }],
	} });
	await controller.actions.effects.add({ scope: 'track', trackId: 'voice', type: 'audacity-invert' });
	await controller.actions.project.setTempo(row.tempo);
	const baseline = snapshot(controller.project);
	const left = baseline.clips.find(clip => clip.sourceStartFrame === SOURCE_IN), right = baseline.clips.find(clip => clip.sourceStartFrame !== SOURCE_IN);
	assert.ok(left?.kind === 'audio' && right?.kind === 'audio');
	let changes = 1;
	await controller.actions.timeline.selectClip(left.id);
	switch (row.action) {
		case 'duplicate-clip': await controller.actions.edit.duplicate(); break;
		case 'ripple-delete':
			await controller.actions.timeline.setExactSelection(Math.round(split * .2), Math.round(split * .52), { trackIds: ['voice'] });
			await controller.actions.edit.deletePerTrackRipple(); break;
		case 'insert-paste':
			await controller.actions.edit.copy(); await controller.actions.timeline.setExactSelection(0, 0, { trackIds: ['voice'] });
			await controller.actions.transport.seek(0); await controller.actions.edit.pasteInsert(); break;
		case 'delete-undo': await controller.actions.clip.remove(right.id); await controller.actions.edit.undo(); changes = 0; break;
		case 'trim-redo':
			await controller.actions.clip.trim(left.id, { durationFrames: split - 4800 });
			await controller.actions.edit.undo(); await controller.actions.edit.redo(); break;
		case 'duplicate-track': await controller.actions.track.duplicate('voice'); break;
		case 'mute-solo':
			await controller.actions.track.update('voice', { mute: true }); await controller.actions.track.update('voice', { solo: true }); changes = 2; break;
		case 'reverse-invert':
			await controller.actions.clip.reverse(right.id); await controller.actions.clip.invert(right.id); changes = 2; break;
		case 'second-split':
			await controller.actions.timeline.setExactSelection(Math.round(split * .52), Math.round(split * .52), { trackIds: ['voice'] });
			await controller.actions.transport.seek(Math.round(split * .52)); await controller.actions.edit.split(); break;
		case 'accent-delete-undo': {
			const bytes = encodeWav([new Float32Array(4800).fill(.5)], { sampleRate: 48_000, bitDepth: 16, dither: false }); assert.ok(bytes instanceof Uint8Array);
			await controller.actions.project.importFiles([new File([Uint8Array.from(bytes)], 'Accent.wav', { type: 'audio/wav' })]);
			const accent = controller.project?.clips.find(clip => clip.sourceId !== source.id); assert.ok(accent);
			await controller.actions.clip.remove(accent.id); await controller.actions.edit.undo(); break;
		}
	}
	const edited = snapshot(controller.project);
	for (let index = 0; index < changes; index++) await controller.actions.edit.undo();
	assert.deepEqual(content(snapshot(controller.project)), content(baseline));
	for (let index = 0; index < changes; index++) await controller.actions.edit.redo();
	assert.deepEqual(content(snapshot(controller.project)), content(edited));
	await controller.actions.project.flush();
	const saved = snapshot(await store.loadProject(edited.id));
	assert.deepEqual(saved, controller.project);
	await initial.close();
	const fresh = await session(context, indexedDB);
	await fresh.controller.actions.project.openById(edited.id);
	assert.equal(fresh.controller.getSnapshot().readOnly, false);
	const restored = snapshot(fresh.controller.project);
	assert.deepEqual(restored, saved, 'a new controller connection reads every saved field, including selection');
	assert.deepEqual(await fresh.store.loadProject(edited.id), saved);
	const archive = createSoundscaperScapeNativeRuntime();
	const exported = await archive.exportScapeProject(restored, fresh.store); assert.ok(exported.blob);
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const reopened = await archive.importScapeProject(exported.blob, recipient);
	assert.equal(reopened.readOnly, false); const delivered = snapshot(reopened.project);
	assert.deepEqual(delivered, restored);
	for (const restoredSource of delivered.sources) {
		assert.ok(restoredSource.kind === 'audio');
		const expected = restoredSource.id === source.id ? pcm : [new Float32Array(4800).fill(.5)];
		assert.deepEqual([restoredSource.sampleRate, restoredSource.frameCount, restoredSource.channelCount], [48_000, expected[0]!.length, expected.length]);
		const actual = expected.map(channel => new Float32Array(channel.length)); let frame = 0;
		for await (const chunk of recipient.readSourceChunks(restoredSource.storageKey)) {
			for (const [index, channel] of chunk.channels.entries()) actual[index]!.set(channel, frame);
			frame += chunk.channels[0]!.length;
		}
		assert.equal(frame, expected[0]!.length); assertPcmChannelsEqual(actual, expected);
	}
	return { project: delivered, split };
}

function snapshot(project: unknown): SoundscaperProject { assert.ok(validateSoundscaperProject(project)); return structuredClone(project); }
function content(project: SoundscaperProject) { const { revision: _revision, updatedAt: _updatedAt, selection: _selection, ...rest } = project; return rest; }
async function session(context: TestContext, indexedDB: ReturnType<typeof createInstrumentedIndexedDB>) {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createSoundscaperProjectStore({ indexedDB, preferOpfs: false }); let closed = false;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), engine: createMemoryEngine() as unknown as Options['engine'],
		engineFactory: () => { throw new Error('Mixed-state custody must never use a substitute DSP renderer.'); } });
	async function close(): Promise<void> { if (!closed) { closed = true; await controller.dispose(); } }
	context.after(close); await controller.ready; return { controller, store, close };
}
