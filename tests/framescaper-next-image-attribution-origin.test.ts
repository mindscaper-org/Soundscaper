/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createProjectAttributionReport, exportProjectAttributionCsv } from '../src/common/editor/project-attribution-report.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('NP025: native image attribution retains its validated original import identity', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const track = fixture.project.tracks.find(item => Array.isArray(item.clipIds) && item.clipIds.includes(fixture.clip.id)); assert.ok(track);
	const placement = { scope: 'timeline', trackId: track.id };
	const base = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, fixture.project, { type: 'batch', commands: [{
		type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: fixture.clip, expectedPlacement: placement, clip: null, placement: null,
	}, { type: 'image-source/set', sourceId: fixture.source.id, expectedSource: fixture.source, source: null }] });
	assert.ok(await environment.createProjectIfAbsent(base));
	const authored = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, base, { type: 'batch', commands: [{
		type: 'image-source/set', sourceId: fixture.source.id, expectedSource: null, source: fixture.source,
	}, { type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: null, expectedPlacement: null, clip: fixture.clip, placement }] });
	assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes: fixture.bytes }));
	const controller = await createFramescaperFixtureController(environment, fixture.project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const before = structuredClone(controller.project);
	const report = createProjectAttributionReport(runtime.projectForRuntimeConsumers(controller.project));
	assert.deepEqual(controller.project, before, 'reading attribution must not rewrite the native image source');
	const source = report.sources.find(source => source.sourceId === fixture.source.id); assert.ok(source);
	assert.equal(source.classification, 'imported', 'fresh native image imports are not legacy unattributed sources');
	assert.equal(source.contributions[0]?.origin.kind, 'local-file');
	const origin = source.contributions[0]?.origin; assert.ok(origin?.kind === 'local-file');
	assert.equal(origin.originalFileName, 'animated.png'); assert.equal(origin.mimeType, 'image/png');
	assert.equal(origin.byteLength, fixture.source.original.byteLength);
	assert.equal(source.warnings.length, 0);
	const csv = exportProjectAttributionCsv(report); assert.ok(csv.includes('animated.png'));
	const imageRow = csv.split('\r\n').find(row => row.startsWith(`"${source.sourceId}",`)); assert.ok(imageRow);
	assert.equal(imageRow.includes('predates provenance tracking'), false);
	assert.ok(report.sources.some(other => other.sourceId !== source.sourceId
		&& other.warnings.some(warning => warning.includes('predates provenance tracking'))), 'actual legacy sources retain their warning');
});
