/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import { createExportRenderProject } from '../src/common/editor/controller/export/export-render-project.ts';
import { assertMatchingExportDataGraph } from '../src/common/editor/project-export-data-graph.ts';
import { parseScapeProjectDocument, serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProject, loadSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

test('the retired Soundscaper keyed video export composition is absent', async () => {
	for (const file of ['video-export-strategy.ts', 'video-export-plan.ts']) {
		await assert.rejects(access(new URL(`../src/soundscaper/${file}`, import.meta.url)), { code: 'ENOENT' });
	}
});

test('the shared export projection preserves a reopened Scape binary extension', () => {
	const payload = Uint8Array.of(7, 12, 18);
	const saved = createSoundscaperProject({ ...framescaperV20Options(), opaqueExtensions: { provenance: { payload } } });
	const document = serializeScapeProjectDocument(saved);
	const reopened = loadSoundscaperProject(parseScapeProjectDocument(document, { currentProjectSchemaFamily: 'soundscaper' }));
	if (reopened.readOnly) assert.fail('The saved Soundscaper document must reopen for editing.');
	const { project } = reopened;
	assert.ok(validateSoundscaperProject(project));
	const exportProject = createExportRenderProject(project);
	assert.doesNotThrow(() => assertMatchingExportDataGraph(
		createExportRenderProject(project), exportProject, 'detached delivery snapshot', 'canonical project',
	));
	assert.deepEqual(exportProject.clips.filter(clip => clip.kind === 'video').map(clip => clip.id), ['video-clip']);
	const opaqueExtensions = exportProject.opaqueExtensions;
	assert.ok(opaqueExtensions && typeof opaqueExtensions === 'object' && 'provenance' in opaqueExtensions);
	assert.deepEqual(opaqueExtensions.provenance, { payload });
	assert.notEqual(exportProject.opaqueExtensions, project.opaqueExtensions);
});

test('the detached render project keeps the delivery effect-bypass projection', () => {
	const options = framescaperV20Options();
	const audioTrack = (options.tracks as Record<string, unknown>[])[1]!;
	audioTrack.effects = [{
		id: 'audio-limiter', type: 'limiter', enabled: true, bypassed: false,
		params: { ceiling: -1, lookahead: 0.005, release: 0.1 },
	}];
	const project = createSoundscaperProject(options as never);
	const deliveryProject = {
		...project,
		tracks: project.tracks.map(track => track.id === 'audio-track' && track.type === 'audio'
			? { ...track, effects: track.effects.map(effect => ({ ...effect, bypassed: true, params: {} })) }
			: track),
	};
	const exportProject = createExportRenderProject(deliveryProject);
	const exportedTrack = exportProject.tracks.find(track => track.id === 'audio-track');
	const originalTrack = project.tracks.find(track => track.id === 'audio-track');
	assert.ok(exportedTrack?.type === 'audio' && originalTrack?.type === 'audio');
	assert.equal(exportedTrack.effects[0]?.bypassed, true);
	assert.equal(originalTrack.effects[0]?.bypassed, false);
});

test('the detached render project keeps the trusted track-folder delivery projection', () => {
	const project = createSoundscaperProject(framescaperV20Options() as never);
	const foldered = applySoundscaperProjectCommand(project, {
		type: 'batch', commands: [
			{
				type: 'track-folder/add', sequenceId: 'main-sequence',
				folder: { id: 'audio-folder', name: 'Audio folder' },
			},
			{
				type: 'track-node/move', sequenceId: 'main-sequence',
				nodeId: 'audio-track', parentFolderId: 'audio-folder', index: 0,
			},
			{
				type: 'track-folder/update', folderId: 'audio-folder', changes: { mute: true },
			},
		],
	} as never);
	const delivery = createSoundscaperPlaybackProjectService()
		.projectForVideoRenderedFallbackDelivery(foldered);
	assert.equal(
		(delivery.project as Readonly<Record<string, unknown>>).trackFolderStateProjectionVersion,
		1,
	);
	assert.equal(delivery.project.tracks.find(({ id }) => id === 'audio-track')?.mute, true);

	const exportProject = createExportRenderProject(delivery.project);
	assert.equal((exportProject as Readonly<Record<string, unknown>>).trackFolderStateProjectionVersion, 1);
	assert.equal(exportProject.tracks.find(({ id }) => id === 'audio-track')?.mute, true);
});
