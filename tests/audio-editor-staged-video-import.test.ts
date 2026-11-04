/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportVideoFile } from '../src/common/editor/controller/import/internal/source-import.ts';
import { createFixture, videoFile } from './helpers/audio-editor-source-import-fixture.ts';

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
