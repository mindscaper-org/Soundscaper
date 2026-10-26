/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { registeredVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const format of ['Edl', 'Otio', 'Fcpxml'] as const) {
	test(`MI21: File Export ${format} loads a reopened variable-rate movie's verified source timing`, async context => {
		const { controller, saved, camera } = await createFixture(context, format);
		assert.equal(registeredVideoTimingIndex(camera), undefined, 'reopening has not registered an incidental playback timing index');
		const result: unknown = await controller.actions.export[`export${format}`]();
		assert.ok(result);
		assert.equal(saved.length, 1);
		const text = await saved[0]!.text();
		if (format === 'Fcpxml') assert.match(text, /start="1\/10s"/u);
		else if (format === 'Edl') assert.match(text, /00:00:00:03 00:00:01:03/u);
		else {
			const document: unknown = JSON.parse(text);
			assert.ok(document && typeof document === 'object' && 'tracks' in document);
			assert.match(text, /"start_time":\s*\{\s*"OTIO_SCHEMA": "RationalTime.1",\s*"value": 3,/u);
		}
		assert.equal(registeredVideoTimingIndex(camera), undefined, 'the interchange action releases its own timing registration');
	});
}

test('MI21: corrupt persisted timing cannot publish an interchange file', async context => {
	const fixture = await createFixture(context, 'corrupt');
	const load = fixture.store.loadMediaAsset.bind(fixture.store);
	fixture.store.loadMediaAsset = async key => key === fixture.timing.reference.storageKey ? new Blob(['bad timing']) : load(key);
	await assert.rejects(fixture.controller.actions.export.exportOtio(), /timing asset is corrupt/u);
	assert.equal(fixture.saved.length, 0);
	assert.equal(registeredVideoTimingIndex(fixture.camera), undefined);
});

test('MI21: switching projects while an interchange timing file loads publishes no stale report or file', async context => {
	const fixture = await createFixture(context, 'switch');
	const load = fixture.store.loadMediaAsset.bind(fixture.store);
	let started!: () => void, release!: () => void;
	const loading = new Promise<void>(resolve => { started = resolve; });
	const gate = new Promise<void>(resolve => { release = resolve; });
	fixture.store.loadMediaAsset = async key => {
		if (key === fixture.timing.reference.storageKey) { started(); await gate; }
		return load(key);
	};
	const exporting = fixture.controller.actions.export.exportOtio();
	try {
		await loading;
		await fixture.controller.actions.project.create({ title: 'New project' });
	} finally { release(); }
	await assert.rejects(exporting, { name: 'AbortError' });
	assert.equal(fixture.saved.length, 0);
	assert.equal(fixture.controller.getSnapshot().deliveryReport, null);
	assert.equal(registeredVideoTimingIndex(fixture.camera), undefined);
});

async function createFixture(context: TestContext, id: string) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const timing = createVideoTimingAssetPublication('ab'.repeat(32), {
		timescale: 1_000, presentationTicks: [0n, 100n, 300n, 600n], finalFrameDurationTicks: 400n,
	});
	const camera = createVideoSource({ id: `vfr-${id}`, name: 'Phone.mp4', storageKey: `phone-${id}.mp4`,
		contentSha256: timing.reference.sourceSha256, sampleFrameCount: 48_000, sourceFrameCount: 4,
		frameRate: { num: 30, den: 1 }, width: 320, height: 180,
		timingDecision: { mode: 'exact', rate: { num: 30, den: 1 } }, timingAsset: timing.reference });
	const project = createSoundscaperProject({ id: `vfr-interchange-${id}`, sampleRate: 48_000,
		sources: [camera], primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture'] }],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['trimmed'] }],
		clips: [{ kind: 'video', id: 'trimmed', sourceId: camera.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 1, sourceFrameCount: 3 }],
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `more-vfr-interchange-${id}` });
	await store.writeMediaAsset(timing.reference.storageKey, new Blob([Uint8Array.from(timing.bytes)]), { kind: 'video-timing' });
	await store.saveProject(project);
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const saved: Blob[] = [];
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		fileService: { async saveFile(request: { blob: Blob }) { saved.push(request.blob); return { fileName: 'Saved' }; } } as unknown as Options['fileService'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.openById(project.id);
	return { controller, store, timing, camera, saved };
}
