/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportVideoFile } from '../src/common/editor/controller/import/internal/source-import.ts';
import { createFixture, videoFile } from './helpers/audio-editor-source-import-fixture.ts';
import { registeredVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { isVideoTimingIndexVerifiedForReference } from '../src/common/editor/video-timing-asset.ts';

test('video clips are editable before preview activation finishes', { timeout: 2_000 }, async () => {
	const fixture = createFixture();
	const held = deferred<void>();
	fixture.options.activationGate = held.promise;
	try {
		const result = await createImportVideoFile(fixture.runtime)(videoFile());
		assert.ok(result.clipId);
		assert.equal(fixture.commits.length, 1);
		assert.deepEqual(fixture.derivatives, []);
	} finally { held.resolve(); }
	await fixture.finishDerivatives();
	assert.equal(fixture.derivatives.length, 3);
});

test('verified exact frame timing is ready when the video clip is committed', async () => {
	const fixture = createFixture();
	const held = deferred<void>();
	fixture.options.activationGate = held.promise;
	Object.assign(fixture.runtime, { helperTimingProbe: { id: 'exact-test', async probe() {
		return { timescale: 1_000, presentationTicks: [0n, 40n, 80n], finalFrameDurationTicks: 40n, nominalRate: { num: 25, den: 1 } };
	} } });
	const commit = fixture.runtime.commit;
	fixture.runtime.commit = (...args) => {
		const source = fixture.addedSources.find(value => value.kind === 'video');
		assert.equal(registeredVideoTimingIndex(source)?.frameCount, 3);
		assert.equal(isVideoTimingIndexVerifiedForReference(registeredVideoTimingIndex(source), source?.timingAsset), true);
		return commit(...args);
	};
	try {
		await createImportVideoFile(fixture.runtime)(new File([Uint8Array.of(1, 2, 3)], 'exact.mp4', { type: 'video/mp4' }));
		assert.equal(fixture.commits.length, 1);
	} finally { held.resolve(); }
	await fixture.finishDerivatives();
	assert.equal(registeredVideoTimingIndex(fixture.addedSources.find(value => value.kind === 'video')), undefined);
});

test('video persistence overlaps audio decoding without publishing partial clips', { timeout: 2_000 }, async () => {
	const fixture = createFixture();
	const decoding = deferred<void>();
	const persisted = deferred<void>();
	const held = deferred<void>();
	const decode = fixture.runtime.engine.decodeAudioData;
	Object.assign(fixture.runtime.engine, { decodeAudioData: async (...args: Parameters<typeof decode>) => {
		decoding.resolve(); await held.promise; return decode(...args);
	} });
	const begin = fixture.runtime.store.beginMediaAssetWrite;
	fixture.runtime.store.beginMediaAssetWrite = async (...args) => {
		persisted.resolve(); await held.promise; return begin(...args);
	};
	const operation = createImportVideoFile(fixture.runtime)(videoFile());
	try {
		await Promise.all([decoding.promise, persisted.promise]);
		assert.equal(fixture.commits.length, 0);
	} finally { held.resolve(); }
	await operation;
	await fixture.finishDerivatives();
	assert.equal(fixture.commits.length, 1);
});

test('undo during deferred video activation releases only that activation visual', async () => {
	const fixture = createFixture();
	const started = deferred<void>(), held = deferred<void>();
	const revoked: (string | null | undefined)[] = [];
	fixture.runtime.activateVideoSource = async () => {
		started.resolve(); await held.promise; return { mediaUrl: 'blob:retired-import' };
	};
	fixture.runtime.revokeVideoVisual = async (_id, expectedMediaUrl) => { revoked.push(expectedMediaUrl); };
	await createImportVideoFile(fixture.runtime)(videoFile());
	await started.promise;
	fixture.editProject({ ...fixture.getProject(), sources: [] });
	held.resolve();
	await fixture.finishDerivatives();
	assert.deepEqual(revoked, ['blob:retired-import']);
	assert.deepEqual(fixture.derivatives, []);
	assert.equal(fixture.protectedSourceIds.size, 0);
});

test('a project switch during linked binding cannot publish clips into the replacement', async () => {
	const fixture = createFixture();
	const started = deferred<void>(), held = deferred<void>();
	const bind = fixture.runtime.store.bindLinkedVideoOriginal;
	fixture.runtime.store.bindLinkedVideoOriginal = async (...args) => {
		const binding = await bind(...args);
		started.resolve(); await held.promise; return binding;
	};
	const operation = createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'timeline', trackId: null, timelineStartFrame: 0,
		linkedVideoLocatorId: 'locator_0000000000000001', linkedVideoLocatorRevision: 'revision_0000000000000001',
	});
	await started.promise;
	fixture.setProject({ id: 'replacement-project', tracks: [], sources: [] });
	held.resolve();
	await assert.rejects(operation, /project changed during video import/iu);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.unlinkedBindings.length, 1);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
});

test('only disposable filmstrip captures opt in to nearby keyframes', async () => {
	const fixture = createFixture();
	const requests: boolean[] = [];
	const factory = fixture.runtime.createAudioEditorVideoFrameExtractor;
	fixture.runtime.createAudioEditorVideoFrameExtractor = async (...args) => {
		const extractor = await factory(...args);
		return { ...extractor, capture(timestamp, options) {
			requests.push(options?.preferKeyframe === true);
			return extractor.capture(timestamp, options);
		} };
	};
	await createImportVideoFile(fixture.runtime)(videoFile());
	await fixture.finishDerivatives();
	assert.deepEqual(requests, [false, true, true]);
});

test('video import publishes playable clips before disposable captures and waveforms settle', { timeout: 2_000 }, async () => {
	const fixture = createFixture();
	const capture = deferred<never>();
	const peaks = deferred<never>();
	const capturing = deferred<void>();
	const analyzing = deferred<void>();
	const factory = fixture.runtime.createAudioEditorVideoFrameExtractor;
	fixture.runtime.createAudioEditorVideoFrameExtractor = async (...args) => ({
			...await factory(...args), capture: () => { capturing.resolve(); return capture.promise; },
	});
	fixture.runtime.generateWaveformPeaks = () => { analyzing.resolve(); return peaks.promise; };
	const result = await createImportVideoFile(fixture.runtime)(videoFile());
	assert.ok(result, 'Import must finish while thumbnails and waveforms are still pending.');
	assert.equal(fixture.commits.length, 1);
	assert.ok(result.audioSourceId, 'Playable audio must be part of the same import.');
	assert.equal(fixture.sourceBuffers.size, 1);
	assert.equal(fixture.sourcePeaks.size, 0);
	assert.deepEqual(fixture.derivatives, []);
	const finished = fixture.finishDerivatives();
	await Promise.all([capturing.promise, analyzing.promise]);
	capture.reject(new Error('Capture unavailable.'));
	peaks.reject(new Error('Waveform unavailable.'));
	await finished;
	assert.equal(fixture.commits.length, 1, 'Derivative failures must preserve the playable import.');
	assert.deepEqual(fixture.deletedMedia, []);
});

test('poster and waveform publish independently while later thumbnails wait and edits survive', { timeout: 2_000 }, async () => {
	const fixture = createFixture();
	const held = deferred<void>();
	const entered = deferred<void>();
	const factory = fixture.runtime.createAudioEditorVideoFrameExtractor;
	fixture.runtime.createAudioEditorVideoFrameExtractor = async (...args) => {
		const extractor = await factory(...args);
		return { ...extractor, async capture(timestamp, options) {
			if (timestamp === 1) { entered.resolve(); await held.promise; }
			return extractor.capture(timestamp, options);
		} };
	};
	await createImportVideoFile(fixture.runtime)(videoFile());
	await entered.promise;
	assert.deepEqual(fixture.derivatives.map(value => value.type), ['poster']);
	assert.equal(fixture.sourcePeaks.size, 1, 'Waveforms must not queue behind the filmstrip.');
	assert.equal(fixture.protectedSourceIds.size, 2);
	fixture.editProject({ ...fixture.getProject(), tracks: [{ id: 'edited-track', type: 'video' }] });
	held.resolve();
	await fixture.finishDerivatives();
	assert.equal(fixture.derivatives.length, 3);
	assert.deepEqual(fixture.getProject().tracks, [{ id: 'edited-track', type: 'video' }]);
	assert.equal(fixture.commits.length, 1, 'Derivatives must not create history entries.');
	assert.equal(fixture.protectedSourceIds.size, 0);
});

for (const change of ['switch', 'delete', 'replace', 'dispose'] as const) {
	test(`pending video derivatives cannot publish after project/source ${change}`, { timeout: 2_000 }, async () => {
		const fixture = createFixture();
		const gate = deferred<void>();
		const capturing = deferred<void>();
		const analyzing = deferred<void>();
		const factory = fixture.runtime.createAudioEditorVideoFrameExtractor;
		const generate = fixture.runtime.generateWaveformPeaks;
		fixture.runtime.createAudioEditorVideoFrameExtractor = async (...args) => {
			const extractor = await factory(...args);
			return { ...extractor, async capture(timestamp, options) {
				capturing.resolve(); await gate.promise;
				return extractor.capture(timestamp, options);
			} };
		};
		fixture.runtime.generateWaveformPeaks = async (...args) => {
			analyzing.resolve(); await gate.promise;
			return generate(...args);
		};
		await createImportVideoFile(fixture.runtime)(videoFile());
		await Promise.all([capturing.promise, analyzing.promise]);
		const project = fixture.getProject();
		if (change === 'switch') fixture.setProject({ ...project });
		else if (change === 'delete') fixture.editProject({ ...project, sources: [] });
		else if (change === 'replace') fixture.editProject({ ...project,
			sources: project.sources.map(source => ({ ...source, contentSha256: 'f'.repeat(64) })) });
		else fixture.lifetime.beginDisposal();
		gate.resolve();
		await fixture.finishDerivatives();
		assert.deepEqual(fixture.derivatives, []);
		assert.equal(fixture.sourcePeaks.size, 0);
		assert.equal(fixture.calls.includes('publish-derivative'), false);
		assert.equal(fixture.calls.includes('save-analysis'), false);
		assert.equal(fixture.protectedSourceIds.size, 0);
		assert.equal(fixture.calls.at(-1), 'dispose');
		assert.deepEqual(fixture.deletedMedia, []);
	});
}

test('repeated capture failures stop the filmstrip while waveform analysis succeeds', async () => {
	const fixture = createFixture();
	const captured: number[] = [];
	const factory = fixture.runtime.createAudioEditorVideoFrameExtractor;
	fixture.runtime.audioEditorVideoThumbnailTimes = () => [1, 2, 3, 4, 5];
	fixture.runtime.createAudioEditorVideoFrameExtractor = async (...args) => ({ ...await factory(...args),
		capture(timestamp) { captured.push(timestamp); return Promise.reject(new Error('Seek timed out.')); },
	});
	await createImportVideoFile(fixture.runtime)(videoFile());
	await fixture.finishDerivatives();
	assert.deepEqual(captured, [0, 1, 2]);
	assert.equal(fixture.sourcePeaks.size, 1);
	assert.equal(fixture.commits.length, 1);
});

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
