/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openDesktopWorkspaceFiles } from '../src/common/editor/ui/workspace/desktop-workspace-file-choice.ts';
import { open } from 'node:fs/promises';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { editorProjectEditSessionKey } from '../src/common/editor/ui/project-edit-session-key.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';
import { framescaperLifetimeController } from './helpers/framescaper-lifetime-controller-fixture.tsx';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { deferred } from './helpers/async-test-control.ts';

for (const sameId of [false, true]) for (const changeAt of ['unchanged', 'choice', 'read'] as const) test(`desktop media choice retains its original session (${changeAt}; sameId=${sameId})`, async context => {
	let projectId = 'original';
	let generation = 1;
	let completeChoice: (descriptors: readonly unknown[]) => void = () => undefined;
	let completeRead: () => void = () => undefined;
	const choice = new Promise<readonly unknown[]>(resolve => { completeChoice = resolve; });
	const read = new Promise<void>(resolve => { completeRead = resolve; });
	let reads = 0;
	let releases = 0;
	const imported: Array<Readonly<{ projectId: string; file: File }>> = [];
	const file = new File([Uint8Array.of(1, 2, 3)], 'Dialogue.wav');
	const operation = openDesktopWorkspaceFiles({
		getProjectId: () => projectId,
		getProjectSessionKey: () => JSON.stringify([projectId, generation]),
		fileService: {
			chooseFiles: () => choice,
			async withReadDescriptors(descriptors, _request, consume) {
				assert.deepEqual(descriptors, [{ id: 'native-choice' }]);
				reads += 1;
				try { await read; return await consume([file]); }
				finally { releases += 1; }
			},
		},
		importFiles: files => { imported.push(...files.map(file => ({ projectId, file }))); },
	}, 'media', true, { destination: 'timeline' });
	if (changeAt === 'choice') { generation++; projectId = sameId ? 'original' : 'replacement'; }
	completeChoice([{ id: 'native-choice' }]);
	await Promise.resolve();
	assert.equal(reads, 1);
	if (changeAt === 'read') { generation++; projectId = sameId ? 'original' : 'replacement'; }
	completeRead();
	assert.equal(await operation, changeAt === 'unchanged' ? 1 : 0);
	assert.equal(releases, 1, 'a completed stale handoff releases its acquired native read');
	assert.deepEqual(imported, changeAt === 'unchanged' ? [{ projectId: 'original', file }] : []);
	if (!sameId && changeAt === 'read') await actualWorkspaceLifetime(context);
});

test('desktop File Open deliberately activates each selected project in order', async () => {
	let projectId = 'original';
	const opened: unknown[] = [];
	const count = await openDesktopWorkspaceFiles({
		getProjectId: () => projectId,
		fileService: {
			chooseFiles: () => Promise.resolve(['first', 'second']),
			withReadDescriptors: () => assert.fail('Project descriptors retain their existing dedicated reader.'),
		},
		openProjectDescriptor: descriptor => { opened.push(descriptor); projectId = String(descriptor); },
		importFiles: () => assert.fail('File Open does not import media.'),
	}, 'project', true);
	assert.equal(count, 2); assert.deepEqual(opened, ['first', 'second']);
});

async function actualWorkspaceLifetime(context: test.TestContext): Promise<void> {
	const { controller, environment, persisted } = await framescaperLifetimeController(context, true);
	// The exact browser fixture is .8 seconds of 48 kHz mono 440 Hz PCM16 at amplitude .35.
	const bytes = encodeWav([new Float32Array(38_400)], { sampleRate: 48_000, bitDepth: 16, dither: 'none' });
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const expected = Float32Array.from({ length: 38_400 }, (_, frame) => {
		const sample = Math.round(Math.sin(2 * Math.PI * 440 * frame / 48_000) * .35 * 32_767);
		view.setInt16(44 + frame * 2, sample, true); return sample / 32_768 || 0;
	});
	for (const destination of ['timeline', 'project-bin'] as const) {
		await controller.actions.project.create({});
		const reading = deferred<void>(), started = deferred<void>();
		let opens = 0;
		const native = await nativeSidecarFixture('browser-mono-tone.wav', bytes, {
			async openSelectedFile(...args) {
				opens++; if (opens === 1) { started.resolve(); await reading.promise; } return open(...args);
			},
		});
		try {
			const fileService = createAudioEditorFileService({ bridge: native.bridge, fetch: native.fetch });
			const choose = () => openDesktopWorkspaceFiles({
				getProjectId: () => controller.project?.id ?? null,
				getProjectSessionKey: () => editorProjectEditSessionKey(controller, controller.project?.id), fileService,
				importFiles: files => destination === 'project-bin'
					? controller.actions.project.importFiles(files, { destination: 'project-bin' })
					: importWorkspaceRoutedFiles({ controller, files, importOptions: {}, projectBinVisible: false,
						openProjectFile: () => assert.fail('The ordinary WAV must route to the real media importer.'),
						requestCueImport: () => assert.fail('The ordinary WAV is not a CUE document.'),
					}),
			}, destination === 'project-bin' ? 'audio-video' : 'media', true);
			const pending = choose();
			await started.promise;
			const outgoing = await persisted();
			await controller.actions.project.create({});
			const before = await persisted(), history = structuredClone(controller.getSnapshot().history);
			assert.notEqual(before.id, outgoing.id);
			reading.resolve();
			assert.equal(await pending, 0);
			assert.equal(native.releases.length, 1);
			assert.deepEqual(await persisted(), before, 'stale chooser cannot admit source/clip/bin data to a new project');
			assert.deepEqual(controller.getSnapshot().history, history, 'stale chooser cannot create replacement history');
			assert.equal(await choose(), 1, 'a completed replacement import fences the retired read');
			assert.equal(native.releases.length, 2);
			const project = await persisted(), expectedCount = 1;
			assert.equal(destination === 'timeline' ? project.clips.length : project.projectBin.clips.length, expectedCount);
			assert.equal(project.clips.length, destination === 'timeline' ? expectedCount : 0);
			for (const source of project.sources) {
				assert.ok(source.kind === 'audio');
				assert.deepEqual([source.sampleRate, source.channelCount, source.frameCount], [48_000, 1, 38_400]);
				const chunks: Float32Array[] = [];
				for await (const chunk of environment.store.readSourceChunks(source.storageKey)) chunks.push(chunk.channels[0]!);
				assertPcmSamplesEqual(Float32Array.from(chunks.flatMap(chunk => [...chunk])), expected, 'every actual WAV sample');
			}
			assert.ok(project.sources.length > 0);
			controller.actions.edit.undo();
			const undone = await persisted();
			assert.equal(destination === 'timeline' ? undone.clips.length : undone.projectBin.clips.length, 0);
			controller.actions.edit.redo();
			assert.deepEqual((await persisted()).clips, project.clips);
			assert.deepEqual((await persisted()).projectBin, project.projectBin);
		} finally { reading.resolve(); await native.close(); }
	}
}
