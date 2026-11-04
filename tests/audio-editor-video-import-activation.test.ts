/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportVideoFile } from '../src/common/editor/controller/import/internal/source-import.ts';
import { claimProtectedSources } from '../src/common/editor/controller/import/internal/protected-source-claims.ts';
import { registeredVideoTimingIndex, registerVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createFixture } from './helpers/audio-editor-source-import-fixture.ts';

test('required video activation waits before staging restores sources without delaying ordinary import or awaiting derivatives', { timeout: 2_000 }, async () => {
	const fixture = exactFixture();
	const held = deferred(), started = deferred(), captures = deferred(), peaks = deferred();
	fixture.runtime.activateVideoSource = async source => {
		started.resolve(); await held.promise;
		const index = registeredVideoTimingIndex(source);
		assert.ok(index);
		registerVideoTimingIndex(source, index);
		return { mediaUrl: 'blob:replacement' };
	};
	const extractor = fixture.runtime.createAudioEditorVideoFrameExtractor;
	fixture.runtime.createAudioEditorVideoFrameExtractor = async (...args) => {
		const value = await extractor(...args);
		return { ...value, async capture(...request: Parameters<typeof value.capture>) { await captures.promise; return value.capture(...request); } };
	};
	const generate = fixture.runtime.generateWaveformPeaks;
	fixture.runtime.generateWaveformPeaks = async (...args) => { await peaks.promise; return generate(...args); };
	const imported = await createImportVideoFile(fixture.runtime)(exactFile());
	assert.ok(imported.clipId, 'Ordinary import must complete while activation is held.');
	const source = fixture.addedSources.find(value => value.kind === 'video');
	assert.ok(source);
	let activated = false;
	const ready = fixture.awaitVideoActivation(imported.sourceId, { signal: new AbortController().signal }).then(() => { activated = true; });
	const releaseStage = claimProtectedSources([imported.sourceId], fixture.protectedSourceIds);
	try {
		await started.promise;
		assert.equal(activated, false);
		held.resolve(); await ready;
		assert.equal(fixture.derivatives.length, 0, 'Activation readiness must not await a filmstrip capture.');
		assert.equal(fixture.sourcePeaks.size, 0, 'Activation readiness must not await waveform analysis.');
		fixture.editProject({ ...fixture.getProject(), sources: [] });
		captures.resolve(); peaks.resolve();
		await fixture.finishDerivatives();
		assert.equal(registeredVideoTimingIndex(source)?.frameCount, 4, 'Preview activation owns the verified index after the temporary import retires.');
		assert.equal(fixture.protectedSourceIds.has(imported.sourceId), true, 'The open replacement choice retains its own source claim.');
	} finally {
		held.resolve(); captures.resolve(); peaks.resolve();
		await ready.catch(() => undefined); await fixture.finishDerivatives();
		releaseStage(); unregisterVideoTimingIndex(source);
	}
	assert.equal(fixture.protectedSourceIds.size, 0);
});

test('required video activation exposes failures while ordinary playable imports remain committed', async () => {
	const fixture = exactFixture();
	fixture.options.activateFails = true;
	const imported = await createImportVideoFile(fixture.runtime)(exactFile());
	await assert.rejects(fixture.awaitVideoActivation(imported.sourceId, { signal: new AbortController().signal }), /activation failed/u);
	await fixture.finishDerivatives();
	assert.equal(fixture.commits.length, 1);
	assert.equal(fixture.protectedSourceIds.size, 0);
	assert.equal(registeredVideoTimingIndex(fixture.addedSources.find(source => source.kind === 'video')), undefined);
});

test('a required waiter cannot mistake a previously failed activation for readiness', async () => {
	const fixture = exactFixture();
	fixture.options.activateFails = true;
	const imported = await createImportVideoFile(fixture.runtime)(exactFile());
	await fixture.finishDerivatives();
	await assert.rejects(fixture.awaitVideoActivation(imported.sourceId, { signal: new AbortController().signal }), /activation failed/u);
});

test('a completed successful activation remains ready for its current canonical source', async () => {
	const fixture = exactFixture();
	fixture.runtime.activateVideoSource = async source => {
		const index = registeredVideoTimingIndex(source); assert.ok(index);
		registerVideoTimingIndex(source, index); return { mediaUrl: 'blob:ready' };
	};
	const imported = await createImportVideoFile(fixture.runtime)(exactFile());
	await fixture.finishDerivatives();
	await fixture.awaitVideoActivation(imported.sourceId, { signal: new AbortController().signal });
	const source = fixture.addedSources.find(candidate => candidate.id === imported.sourceId);
	assert.equal(registeredVideoTimingIndex(source)?.frameCount, 4);
	unregisterVideoTimingIndex(source);
});

for (const change of ['project', 'delete', 'replace', 'dispose'] as const) test(`completed activation readiness still rejects retired source ownership: ${change}`, async () => {
	const fixture = exactFixture();
	fixture.runtime.activateVideoSource = async () => ({ mediaUrl: 'blob:current' });
	const imported = await createImportVideoFile(fixture.runtime)(exactFile());
	await fixture.finishDerivatives();
	const project = fixture.getProject();
	if (change === 'project') fixture.setProject({ ...project });
	else if (change === 'delete') fixture.editProject({ ...project, sources: [] });
	else if (change === 'replace') fixture.editProject({ ...project,
		sources: project.sources.map(source => ({ ...source, contentSha256: 'f'.repeat(64) })) });
	else fixture.lifetime.beginDisposal();
	await assert.rejects(fixture.awaitVideoActivation(imported.sourceId, { signal: new AbortController().signal }));
});

test('cancelling required video readiness terminates the wait and fences late activation', async () => {
	const fixture = exactFixture();
	const held = deferred(), started = deferred();
	fixture.runtime.activateVideoSource = async () => { started.resolve(); await held.promise; return { mediaUrl: 'blob:retired' }; };
	const imported = await createImportVideoFile(fixture.runtime)(exactFile());
	const cancellation = new AbortController();
	const ready = fixture.awaitVideoActivation(imported.sourceId, { signal: cancellation.signal });
	const rejected = assert.rejects(ready, { name: 'AbortError' });
	await started.promise;
	cancellation.abort();
	await rejected;
	fixture.editProject({ ...fixture.getProject(), sources: [] });
	held.resolve(); await fixture.finishDerivatives();
	assert.equal(fixture.protectedSourceIds.size, 0);
	assert.deepEqual(fixture.derivatives, []);
	assert.equal(registeredVideoTimingIndex(fixture.addedSources.find(source => source.kind === 'video')), undefined);
});

function exactFixture() {
	const fixture = createFixture();
	Object.assign(fixture.runtime, { helperTimingProbe: { id: 'exact-replacement', async probe() {
		return { timescale: 1_000, presentationTicks: [0n, 40n, 130n, 200n], finalFrameDurationTicks: 70n, nominalRate: { num: 400, den: 27 } };
	} } });
	return fixture;
}

function exactFile() { return new File([Uint8Array.of(1, 2, 3)], 'replacement.mp4', { type: 'video/mp4' }); }
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(complete => { resolve = complete; });
	return { promise, resolve };
}
