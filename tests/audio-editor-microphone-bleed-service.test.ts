/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMicrophoneBleedService } from '../src/common/editor/controller/effects/internal/microphone-bleed-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createEnvelopeValueEvaluator } from '../src/common/editor/automation.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

function fixture() {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate('podcast');
	let project = { id: 'podcast', revision: 1, tracks: [
		{ id: 'a', type: 'audio', clipIds: ['ca'] }, { id: 'b', type: 'audio', clipIds: ['cb'] },
	], clips: [
		{ id: 'ca', sourceId: 'sa', timelineStartFrame: 0, durationFrames: 64000, envelope: [] },
		{ id: 'cb', sourceId: 'sb', timelineStartFrame: 0, durationFrames: 64000, envelope: [{ frame: 0, value: .5 }] },
	] };
	const commands: AudioEditorCommand[] = [], processing: boolean[] = [], reads: number[] = [];
	let seed = 31, smooth = 0;
	const pcm = Float32Array.from({ length: 64000 }, () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; smooth = .85 * smooth + .15 * seed / 2 ** 31; return smooth; });
	const deps = {
		lifetime, copy: ENGLISH_COPY, getProject: () => project,
		captureProject: () => generation.capture(), assertProject: generation.assertCurrent.bind(generation),
		getSelection: () => ({ startFrame: 8000, endFrame: 56000, trackIds: ['a', 'b'] }),
		projectSampleRate: () => 8000, editingBlocked: () => false,
		render: async (track: string, start: number, end: number) => {
			reads.push(end - start);
			return [Float32Array.from(pcm.slice(start, end), value => value * (track === 'a' ? 1 : .2))];
		},
		commit: (command: AudioEditorCommand) => { commands.push(command); },
		setProcessing: (value: boolean) => { processing.push(value); }, publish() {}, onProgress(_value: number) {},
	};
	return { deps, commands, processing, reads, generation, project, edit() { project = { ...project, revision: 2 }; } };
}

test('bounded joint analysis publishes only clip envelopes in a single undoable batch', async () => {
	const f = fixture(), before = structuredClone(f.project);
	const result = await createMicrophoneBleedService(f.deps)();
	assert.equal(result.changedClipCount, 1);
	assert.equal(f.commands.length, 1);
	assert.equal(f.commands[0]!.type, 'batch');
	const command = f.commands[0]!;
	assert.equal(command.type, 'batch');
	if (command.type !== 'batch') return;
	assert.equal(command.commands.length, 1);
	assert.partialDeepStrictEqual(command.commands[0], { type: 'clip/update', clipId: 'cb' });
	const update = command.commands[0]!;
	if (update.type !== 'clip/update') return;
	assert.deepEqual(Object.keys(update.changes), ['envelope']);
	const envelope = update.changes.envelope as { frame: number; value: number }[];
	const gain = createEnvelopeValueEvaluator(envelope, 64000);
	assert.equal(gain(4000), .5);
	assert.ok(Math.abs(gain(40000) - .5 * 10 ** (-12 / 20)) < 1e-6, 'a chunk boundary does not reopen the microphone');
	assert.equal(gain(60000), .5);
	assert.deepEqual(f.project, before, 'source and project objects remain untouched before commit');
	assert.ok(f.reads.every(length => length <= 40640));
	assert.deepEqual(f.processing, [true, false]);
});

test('edits, project switches and cancellation during rendering never publish partial envelopes', async () => {
	for (const change of ['edit', 'switch', 'cancel'] as const) {
		const f = fixture(), cancellation = new AbortController(), render = f.deps.render;
		f.deps.render = async (...args) => {
			const result = await render(...args);
			if (change === 'edit') f.edit();
			else if (change === 'switch') f.generation.activate('other');
			else cancellation.abort();
			return result;
		};
		await assert.rejects(createMicrophoneBleedService(f.deps)({}, cancellation.signal), { name: 'AbortError' });
		assert.deepEqual(f.commands, []);
		assert.equal(f.processing.at(-1), false);
	}
});

test('invalid selections, locked tracks, and malformed worker results refuse publication', async () => {
	const f = fixture();
	await assert.rejects(createMicrophoneBleedService({ ...f.deps, getSelection: () => null })());
	await assert.rejects(createMicrophoneBleedService({ ...f.deps, getProject: () => ({ ...f.project, tracks: f.project.tracks.map(track => ({ ...track, locked: true })) }) })());
	assert.deepEqual(f.reads, []);
	await assert.rejects(createMicrophoneBleedService({ ...f.deps, analyze: async () => [[true]] })());
	assert.deepEqual(f.commands, []);
});

test('an unchanged result authors no history and wide channel layouts stop before joint allocation', async () => {
	const f = fixture();
	assert.deepEqual(await createMicrophoneBleedService(f.deps)({ maximumReductionDb: 0 }), { changedClipCount: 0 });
	assert.deepEqual(f.commands, []);
	let renders = 0;
	await assert.rejects(createMicrophoneBleedService({ ...f.deps, render: async (_track, start, end) => {
		renders++;
		return Array.from({ length: 3 }, () => new Float32Array(end - start));
	} })(), /mono or stereo/);
	assert.equal(renders, 1);
	assert.deepEqual(f.commands, []);
});

test('cancelling while the worker is pending prevents publication', async () => {
	const f = fixture(), cancellation = new AbortController();
	await assert.rejects(createMicrophoneBleedService({ ...f.deps, analyze: async () => {
		cancellation.abort();
		return [];
	} })({}, cancellation.signal), { name: 'AbortError' });
	assert.deepEqual(f.commands, []);
	assert.equal(f.processing.at(-1), false);
});
