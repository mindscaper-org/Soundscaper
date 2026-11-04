/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { clipFixture, createHarness, projectFixture } from './helpers/project-bin-service-harness.ts';

test('video replacement keeps the imported source current until required activation settles', async () => {
	const activation = deferred();
	const requests: string[] = [];
	const harness = replacementHarness(async sourceId => {
		requests.push(sourceId);
		await activation.promise;
	});
	const preparing = harness.service.prepareProjectBinReplacement('bin', { name: 'replacement.mp4' });
	try {
		await Promise.resolve(); await Promise.resolve();
		assert.deepEqual(requests, ['new-video']);
		assert.equal(harness.restoreCount, 0, 'Restoration must not retire a pending exact timing lease.');
		assert.equal(harness.project.sources.some(source => source.id === 'new-video'), true);
	} finally { activation.resolve(); await preparing.catch(() => undefined); }
	const prepared = await preparing;
	assert.equal(harness.restoreCount, 1);
	assert.equal(harness.project, harness.base);
	assert.ok(prepared);
	assert.equal(harness.service.applyProjectBinReplacement(prepared.token), 'bin');
	assert.equal(harness.commits.length, 1);
});

test('required replacement activation failure restores the original and retires the staged media', async () => {
	const failure = new Error('Required video activation failed.');
	const harness = replacementHarness(async () => { throw failure; });
	await assert.rejects(harness.service.prepareProjectBinReplacement('bin', { name: 'replacement.mp4' }), failure);
	assert.equal(harness.project, harness.base);
	assert.equal(harness.importing, false);
	assert.deepEqual(harness.deletedMedia, ['new-video']);
	assert.equal(harness.protectedSourceIds.size, 0);
	assert.equal(harness.commits.length, 0);
});

test('cancelling required activation cannot publish a staged replacement', async () => {
	const started = deferred();
	const harness = replacementHarness((_sourceId, { signal }) => new Promise<void>((_resolve, reject) => {
		started.resolve();
		signal.addEventListener('abort', () => { reject(signal.reason); }, { once: true });
	}));
	const preparing = harness.service.prepareProjectBinReplacement('bin', { name: 'replacement.mp4' });
	const rejected = assert.rejects(preparing, { name: 'AbortError' });
	await started.promise;
	await harness.service.cancelAllProjectBinReplacements();
	await rejected;
	assert.equal(harness.project, harness.base);
	assert.equal(harness.importing, false);
	assert.deepEqual(harness.deletedMedia, ['new-video']);
	assert.equal(harness.protectedSourceIds.size, 0);
	assert.equal(harness.commits.length, 0);
});

test('a project switch during required activation cannot restore the outgoing staged document', async () => {
	const activation = deferred(), started = deferred();
	const harness = replacementHarness(async () => { started.resolve(); await activation.promise; });
	const preparing = harness.service.prepareProjectBinReplacement('bin', { name: 'replacement.mp4' });
	const rejected = assert.rejects(preparing, { name: 'AbortError' });
	await started.promise;
	const incoming = projectFixture({ id: 'incoming' });
	harness.switchProject(incoming);
	activation.resolve(); await rejected;
	assert.equal(harness.project, incoming);
	assert.deepEqual(harness.deletedMedia, ['new-video']);
	assert.equal(harness.protectedSourceIds.size, 0);
	assert.equal(harness.commits.length, 0);
});

for (const fail of [false, true]) test(`a document edit during required activation is retained, activation failure=${fail}`, async () => {
	const activation = deferred(), started = deferred();
	const harness = replacementHarness(async () => {
		started.resolve(); await activation.promise;
		if (fail) throw new Error('Activation failed after the edit.');
	});
	const preparing = harness.service.prepareProjectBinReplacement('bin', { name: 'replacement.mp4' });
	const rejected = assert.rejects(preparing);
	await started.promise;
	const edited = { ...harness.project, revision: harness.project.revision + 1 };
	harness.replaceImportedDocument(edited);
	activation.resolve(); await rejected;
	assert.equal(harness.project, edited);
	assert.deepEqual(harness.deletedMedia, [], 'Sources retained by the edited document must remain available.');
	assert.equal(harness.protectedSourceIds.size, 0);
	assert.equal(harness.commits.length, 0);
});

function replacementHarness(awaitVideoSourceActivation: NonNullable<Parameters<typeof createHarness>[1]>['awaitVideoSourceActivation']) {
	const original = createVideoSource({ id: 'old-video', storageKey: 'old-video', name: 'Original',
		contentSha256: '12'.repeat(32), sampleFrameCount: 48_000, sourceFrameCount: 10,
		frameRate: { num: 10, den: 1 }, width: 96, height: 54 });
	const replacement = createVideoSource({ id: 'new-video', storageKey: 'new-video', name: 'Replacement',
		contentSha256: '34'.repeat(32), sampleFrameCount: 12_960, sourceFrameCount: 4,
		frameRate: { num: 400, den: 27 }, width: 96, height: 54 });
	const base = { ...projectFixture({
		projectBinClips: [clipFixture({ id: 'bin', sourceId: 'old-video', kind: 'video', binItemId: 'old-item',
			sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 10 })],
		sources: [original],
	}), primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 } }] };
	const imported = { ...base,
		projectBin: { clips: [clipFixture({ id: 'imported-bin', sourceId: 'new-video', kind: 'video', binItemId: 'new-item',
			sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 8, sourceInFrame: 0, sourceFrameCount: 4 })] },
		sources: [...base.sources, replacement],
	};
	const protectedSourceIds = new Set<string>();
	const harness = createHarness(base, {
		protectedSourceIds, awaitVideoSourceActivation,
		importProjectBinFile: async () => { harness.replaceImportedDocument(imported); return { clipId: 'imported-bin' }; },
	});
	return Object.assign(harness, { base, protectedSourceIds });
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(complete => { resolve = complete; });
	return { promise, resolve };
}
