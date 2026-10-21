/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectDocument } from '../src/common/editor/controller/document/native-project-types.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}
function project(): NativeProjectDocument {
	return createSoundscaperProject({ id: 'project-a' }) as unknown as NativeProjectDocument;
}
async function archive(value: NativeProjectDocument): Promise<Blob> {
	const result = await exportScapeProject(value, {
		readSourceChunks: async function* () { yield [new Float32Array(1)]; },
		loadMediaAsset: async () => null,
	});
	assert.ok(result.blob instanceof Blob);
	return result.blob;
}

test('MP03: a canceled Scape save preserves the manifest of the last saved archive', async () => {
	const snapshot = project(), blob = await archive(snapshot);
	const fixture = createFixture({ getProject: () => snapshot,
		exportScapeProject: async () => ({ blob, manifest: {} }),
		fileService: { isDesktop: false,
			prepareSave: async () => ({ mode: 'blob', fileName: 'cancelled.sscape', target: {} }),
			saveFile: async () => ({ cancelled: true }),
		},
	});
	const previous = Object.freeze({ fileName: 'previous.sscape', manifest: { members: [] } });
	const state = fixture.state as unknown as Record<string, unknown>;
	state.archiveManifest = previous;
	await assert.rejects(createNativeProjectService(fixture.runtime).saveScape(), { name: 'AbortError' });
	assert.equal(state.archiveManifest, previous);
});

test('MP05: Scape archive reports identify the filename actually chosen by the user', async () => {
	const snapshot = project(), blob = await archive(snapshot);
	const fixture = createFixture({ getProject: () => snapshot,
		exportScapeProject: async () => ({ blob, manifest: {} }),
		fileService: { isDesktop: false,
			prepareSave: async () => ({ mode: 'blob', fileName: 'suggested.sscape', target: {} }),
			saveFile: async () => ({ fileName: 'chosen.sscape', size: blob.size }),
		},
	});
	await createNativeProjectService(fixture.runtime).saveScape();
	const state = fixture.state as unknown as { archiveManifest: { fileName: string } };
	assert.equal(state.archiveManifest.fileName, 'chosen.sscape');
});

test('MP04: editing while a native archive is being saved leaves the newer document dirty', async () => {
	for (const format of ['scape', 'aup4'] as const) {
		let current = project();
		const entered = deferred(), release = deferred();
		const baseline = createFixture();
		const client = baseline.runtime.createAup4Client({});
		const fixture = createFixture({ getProject: () => current,
			exportScapeProject: async () => {
				entered.resolve(); await release.promise;
				return { blob: await archive(project()), manifest: {} };
			},
			createAup4Client: () => ({ ...client, export: async () => {
				entered.resolve(); await release.promise;
				return { bytes: Uint8Array.of(1), validation: {} };
			} }),
		});
		const service = createNativeProjectService(fixture.runtime);
		const saving = format === 'scape' ? service.saveScape() : service.saveAup4({ useFileSystemAccess: false });
		await entered.promise;
		current = { ...current, revision: Number(current.revision ?? 0) + 1, title: 'Edited while saving' };
		fixture.state.saveState = 'dirty';
		release.resolve();
		await saving;
		assert.equal(fixture.state.saveState, 'dirty', format);
	}
});

test('MP06: Audacity export reads the sources belonging to its prepared snapshot', async () => {
	let current = project();
	const source = createAudioSource({ id: 'new-source', frameCount: 1, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: 1, durationFrames: 1 });
	const track = createAudioTrack({ id: 'track', clipIds: [clip.id] });
	const baseline = createFixture(), client = baseline.runtime.createAup4Client({});
	const received: string[] = [];
	const fixture = createFixture({ getProject: () => current,
		prepareAudacityProjectExport: async () => {
			current = createSoundscaperProject({ id: current.id, revision: 1,
				sources: [source], clips: [clip], tracks: [track] }) as unknown as NativeProjectDocument;
			return current;
		},
		createAup4Client: () => ({ ...client, writeSnapshot: async (_id, snapshot, sources) => {
			assert.equal(snapshot.sources.length, 1);
			for await (const value of sources) received.push(value.sourceId);
			return {};
		} }),
	});
	await createNativeProjectService(fixture.runtime).saveAup4({ useFileSystemAccess: false });
	assert.deepEqual(received, ['new-source']);
});
