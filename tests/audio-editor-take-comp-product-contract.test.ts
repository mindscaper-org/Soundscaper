/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createTakeCompService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-service.ts';
import { createTakeCompFlattenService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-flatten-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioSource, createAudioTrack, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createImportedSourceProvenance, type SourceProvenanceV1 } from '../src/common/editor/source-provenance.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { TakeCompProject } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-project.ts';
import type { TakeCompCompositionDependencies } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-composition.ts';
import type { TakeCompPreviewDependencies } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-preview-service.ts';
import type { TakeCompFlattenServiceDependencies } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-flatten-service.ts';

test('take-comp owners accept the actual Framescaper document without changing its schema', () => {
	const project = createFramescaperProject();
	const provider = { getProject: () => project } satisfies
		Pick<TakeCompCompositionDependencies, 'getProject'> &
		Pick<TakeCompPreviewDependencies, 'getProject'> &
		Pick<TakeCompFlattenServiceDependencies, 'getProject'>;
	let commits = 0;
	const service = createTakeCompService({
		...provider,
		lifetime: { assertActive() {} },
		editingBlocked: () => false,
		commit: () => { commits += 1; },
	});
	assert.throws(() => service.removeGroup('missing'), /Unknown take group/);
	assert.equal(provider.getProject(), project);
	assert.equal(project.schemaVersion, 1);
	assert.equal(commits, 0);
});

test('a real mixed media document flattens only attributed PCM and preserves image custody', async () => {
	const project = mixedProject();
	const image = project.sources.find(({ kind }) => kind === 'image');
	assert.ok(image && image.schemaVersion === 1);
	const fixture = flattenFixture(project);
	const result = await fixture.owner.flatten('take-group');
	assert.deepEqual(fixture.renderedSourceIds, ['take-source']);
	assert.deepEqual(fixture.provenance()?.contributions.map(({ id }) => id), ['audio-attribution']);
	assert.equal(fixture.provenance()?.classification, 'derived');
	assert.equal(fixture.persistCount(), 1);
	assert.deepEqual(fixture.project().sources.find(({ id }) => id === image.id), image);
	assert.deepEqual(fixture.project().takeGroups, []);
	assert.equal(fixture.project().sources.some(({ id }) => id === result.publication.source.id), true);
	assert.equal(fixture.commitCount(), 1);
});

function mixedProject() {
	const image = createFramescaperBaselineImageFixture({ imageOnly: true });
	const audio = createAudioSource({ id: 'take-source', storageKey: 'take-source', name: 'Recorded take',
		mimeType: 'audio/wav', frameCount: 4, channelCount: 1, sampleRate: 48_000,
		provenance: createImportedSourceProvenance({ id: 'audio-attribution',
			origin: { kind: 'local-file', originalFileName: 'take.wav', mimeType: 'audio/wav' } }) });
	const project = createFramescaperProject(PROFILE, { id: 'mixed-project', sampleRate: 48_000,
		sources: [audio], clips: [],
		tracks: [createVideoTrack({ id: 'video-track', clipIds: [] }),
			createAudioTrack({ id: 'take-track', name: 'Take', clipIds: [] })],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track', 'take-track'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [{ id: 'take-group', sequenceId: 'main-sequence', trackId: 'take-track',
			startSample: 0, endSample: 4, laneOrder: ['lane'], lanes: [{ id: 'lane' }],
			takes: [{ id: 'take', laneId: 'lane', sourceId: audio.id, startSample: 0, endSample: 4, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 4 }] }],
	});
	return applyFramescaperProjectCommand(PROFILE, project, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: image.source.id, expectedSource: null, source: image.source },
		{ type: 'image-clip/set', clipId: image.clip.id, expectedClip: null, expectedPlacement: null,
			clip: image.clip, placement: { scope: 'timeline', trackId: 'video-track' } },
	] });
}

function flattenFixture(initial: TakeCompProject) {
	let current = initial, commits = 0, persists = 0, rollbacks = 0;
	let provenance: SourceProvenanceV1 | undefined;
	const renderedSourceIds: string[] = [];
	const lifetime = new EditorControllerLifetime();
	const provider = { getProject: () => current, lifetime, editingBlocked: () => false,
		commit(command: Parameters<typeof applyFramescaperProjectCommand>[2]) {
			current = applyFramescaperProjectCommand(PROFILE, current, command);
			commits += 1;
			return current;
		} };
	const service = createTakeCompService(provider);
	let nextId = 0;
	const owner = createTakeCompFlattenService({ ...provider, service,
		sourceBuffers: new Map(), sourceChunkProviders: new Map(),
		captureProject: () => ({ generation: 1, projectId: 'mixed-project' }), assertProject() {},
		createId: (prefix) => `${prefix}-${String(++nextId)}`,
		async renderSnapshot(project) {
			renderedSourceIds.push(...(project.sources ?? []).map(({ id }) => String(id)));
			return { length: 4, numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => new Float32Array(4) };
		},
		derivedSources: {
			async persistRenderedMixSource(rendered, name, value) {
				persists += 1; provenance = value;
				return { source: createAudioSource({ id: 'flat-source', storageKey: 'flat-source', name,
					mimeType: 'audio/wav', frameCount: rendered.length, channelCount: rendered.numberOfChannels,
					sampleRate: rendered.sampleRate, ...(value ? { provenance: value } : {}) }), buffer: rendered, channels: null };
			},
			async rollbackDerivedSources() { rollbacks += 1; },
		},
	});
	return { owner, renderedSourceIds, project: () => current, provenance: () => provenance,
		persistCount: () => persists, commitCount: () => commits, rollbackCount: () => rollbacks };
}
