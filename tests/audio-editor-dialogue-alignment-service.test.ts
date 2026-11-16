/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDialogueAlignmentService, type DialogueAlignmentServiceDependencies } from '../src/common/editor/controller/track-audio/internal/dialogue-alignment-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { ControllerSource } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { dialogueFixture } from './helpers/dialogue-alignment-fixture.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

function fixture() {
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate('dialogue');
	const source = (id: string): ControllerSource => ({ id, name: id, storageKey: id, mimeType: 'audio/wav',
		frameCount: 8000, channelCount: 1, sampleRate: 8000, originalSampleRate: 8000 });
	const project = { id: 'dialogue', title: 'ADR', schemaVersion: 30, revision: 1, sampleRate: 8000,
		clips: ['reference', 'replacement'].map((id, index) => ({ id, sourceId: `source-${index}`, title: id,
			timelineStartFrame: index * 8000, durationFrames: 8000, sourceStartFrame: 0, sourceDurationFrames: 8000 })),
		sources: [source('source-0'), source('source-1')], tracks: ['reference', 'replacement'].map(id => ({ id: `track-${id}`, name: id,
			type: 'audio' as const, clipIds: [id], locked: false })), mixer: { groups: [], sends: [] } };
	const commits: AudioEditorCommand[] = [], rollback: string[] = [], reads: string[] = [], processing: boolean[] = [];
	let sequence = 0;
	const pcm = dialogueFixture([.5, .5]);
	const deps: DialogueAlignmentServiceDependencies = {
		lifetime, copy: ENGLISH_COPY, getProject: () => project, editingBlocked: () => false,
		captureProject: () => generation.capture(), assertProject: value => generation.assertCurrent(value),
		createId: prefix => `${prefix}-${++sequence}`, preflightStorage: async () => {},
		render: async (_track, _start, _end, _channels, ids) => { reads.push(...ids); return [pcm]; },
		align: async () => ({ channels: [pcm.slice()], alignment: { inputFrames: 8000, outputFrames: 8000, mismatch: .1,
			points: [{ outputFrame: 0, sourceFrame: 0 }, { outputFrame: 8000, sourceFrame: 8000 }] } }),
		derivedSources: {
			persistDerivedSource: async (template, channels, name) => ({ source: { ...template, id: 'aligned-source', storageKey: 'aligned-source', name }, channels, buffer: null }),
			rollbackDerivedSources: async records => { rollback.push(...records.map(record => record.source.id)); },
		},
		commit: command => { commits.push(command); }, setProcessing: value => processing.push(value), publish() {},
	};
	return { deps, project, generation, commits, rollback, reads, processing };
}
const options = { referenceClipId: 'reference', replacementClipId: 'replacement', strength: 1 };

test('dialogue review is private, then publishes one new track and source in one batch without changing either input', async () => {
	const f = fixture(), before = structuredClone(f.project), service = createDialogueAlignmentService(f.deps);
	const review = await service.prepare(options);
	assert.equal(f.commits.length, 0); assert.deepEqual(f.reads, ['reference', 'replacement']);
	assert.equal(service.previewAudio(review.id, 'aligned').channels[0]!.length, 8000);
	await service.apply(review.id);
	assert.deepEqual(f.project, before); assert.equal(f.commits.length, 1);
	const command = f.commits[0]!;
	assert.equal(command.type, 'batch');
	if (command.type !== 'batch') return;
	assert.deepEqual(command.commands.map(value => value.type), ['source/add', 'track/add', 'clip/add']);
	assert.partialDeepStrictEqual(command.commands[2], { clip: { timelineStartFrame: 0, durationFrames: 8000, sourceStartFrame: 0 } });
	const persisted = createSoundscaperProject({ id: f.project.id, sampleRate: 8000,
		sources: f.project.sources.map(value => createAudioSource(value)), clips: f.project.clips.map(value => createAudioClip(value)),
		tracks: f.project.tracks.map(value => createAudioTrack(value, 8000)) });
	const reopened = createSoundscaperProject(applySoundscaperProjectCommand(persisted, command));
	assert.equal(reopened.tracks.length, 3); assert.equal(reopened.sources.length, 3);
	assert.equal(reopened.clips[2]!.sourceId, 'aligned-source');
	assert.equal(reopened.clips[2]!.durationFrames, 8000);
	await assert.rejects(service.apply(review.id)); assert.equal(f.commits.length, 1);
	assert.deepEqual(f.processing, [true, false, true, false]);
});

test('edits, project switches, cancellation and invalid worker output discard analysis before publication', async () => {
	for (const change of ['edit', 'switch', 'cancel', 'invalid'] as const) {
		const f = fixture(), cancellation = new AbortController(), align = f.deps.align!;
		const service = createDialogueAlignmentService({ ...f.deps, align: async (...args) => {
			if (change === 'edit') f.project.revision++;
			if (change === 'switch') f.generation.activate('other');
			if (change === 'cancel') cancellation.abort();
			const result = await align(...args);
			return change === 'invalid' ? { ...result, channels: [new Float32Array([NaN])] } : result;
		} });
		await assert.rejects(service.prepare(options, cancellation.signal));
		assert.deepEqual(f.commits, []); assert.equal(f.processing.at(-1), false);
	}
});

test('stale acceptance and cancellation after source persistence roll back without a partial edit', async () => {
	for (const change of ['edit', 'cancel', 'discard', 'commit-failure'] as const) {
		const f = fixture(), cancellation = new AbortController();
		const persist = f.deps.derivedSources.persistDerivedSource;
		const service = createDialogueAlignmentService({ ...f.deps,
			commit: change === 'commit-failure' ? () => { throw new Error('write failed'); } : f.deps.commit,
			derivedSources: { ...f.deps.derivedSources, persistDerivedSource: async (...args) => {
				const result = await persist(...args);
				if (change === 'edit') f.project.revision++;
				if (change === 'cancel') cancellation.abort();
				if (change === 'discard') service.discard();
				return result;
			} },
		});
		const review = await service.prepare(options);
		await assert.rejects(service.apply(review.id, cancellation.signal));
		assert.deepEqual(f.rollback, ['aligned-source']); assert.deepEqual(f.commits, []);
	}
});

test('locked, identical and missing dialogue targets are rejected without reading audio', async () => {
	const f = fixture(), service = createDialogueAlignmentService(f.deps);
	f.project.tracks[0]!.locked = true;
	await assert.rejects(service.prepare(options));
	f.project.tracks[0]!.locked = false;
	await assert.rejects(service.prepare({ ...options, referenceClipId: 'replacement' }));
	await assert.rejects(service.prepare({ ...options, referenceClipId: 'missing' }));
	assert.deepEqual(f.reads, []);
});

test('dialogue preparation captures settings before asynchronous source reads', async () => {
	const f = fixture(), mutable = { ...options }, read = f.deps.render;
	const service = createDialogueAlignmentService({ ...f.deps, render: async (...args) => { mutable.strength = 0; return read(...args); },
		align: async (...args) => { assert.equal(args[0].strength, 1); return f.deps.align!(...args); } });
	await service.prepare(mutable);
});
