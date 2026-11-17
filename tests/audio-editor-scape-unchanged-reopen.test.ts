/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';
import { unzipSync } from 'fflate';
import { makeStoredZip } from './helpers/stored-zip.js';
import { CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY } from '../src/common/transfer/cross-product-handoff-provenance.ts';

async function fixture(context: TestContext, opaqueExtensions: Record<string, unknown> = {}) {
	const runtime = createSoundscaperScapeNativeRuntime();
	const { controller, store } = await controllerSession(context, { scapeProjectRuntime: runtime });
	const source = createAudioSource({ id: 'lp-input', name: 'LP input', sampleRate: 48_000, frameCount: 4, channelCount: 1 });
	const clip = createAudioClip({ id: 'lp-side', sourceId: source.id, durationFrames: 4, sourceDurationFrames: 4 });
	const project = createSoundscaperProject({ id: 'lp-reopen', title: 'LP side A', opaqueExtensions, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'lp-track', clipIds: [clip.id] })] });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([Float32Array.from([0.5, -0.5, 0.25, -0.25])]);
	await writer.commit();
	await store.saveProject(project);
	await controller.actions.project.open(project);
	await controller.actions.project.save();
	const saved = await store.loadProject(project.id);
	assert.ok(saved);
	const archive = await runtime.exportScapeProject(saved, store);
	assert.ok(archive.blob);
	return { controller, store, runtime, project: saved, file: new File([archive.blob], 'LP.sscape'), source };
}

test('opening an unchanged saved LP resumes its library identity and retains PCM and undo history', async context => {
	const { controller, store, project, file, source } = await fixture(context);
	const before = await store.listProjects();
	const result = await controller.actions.project.openScapeFile(file, () => assert.fail('An unchanged reopen must not prompt.'));
	assert.ok(result && typeof result === 'object' && !('cancelled' in result));
	assert.equal(controller.project?.id, project.id);
	assert.deepEqual(await store.listProjects(), before, 'reopening creates no copy or replacement revision');
	assert.deepEqual(await readPcm(store, source.storageKey), [[0.5, -0.5, 0.25, -0.25]]);
	await controller.actions.project.rename('LP side A edited');
	await controller.actions.project.save();
	const changed = await store.loadProject(project.id);
	assert.ok(changed);
	const exported = await createSoundscaperScapeNativeRuntime().exportScapeProject(changed, store);
	assert.ok(exported.blob);
	await controller.actions.project.openScapeFile(new File([exported.blob], 'LP-edited.sscape'), () => assert.fail('Unchanged edit must resume.'));
	await controller.actions.edit.undo();
	assert.equal(controller.project?.title, 'LP side A');
});

test('an unchanged closed project resumes when another project is active', async context => {
	const { controller, project, file } = await fixture(context);
	await controller.actions.project.create({ title: 'Another recording' });
	assert.equal((await controller.actions.project.close(project.id, { discard: true })).closed, true);
	await controller.actions.project.openScapeFile(file, () => assert.fail('An unchanged library project must resume.'));
	assert.equal(controller.project?.id, project.id);
	assert.equal(controller.project?.title, 'LP side A');
});

test('ordinary unchanged reopens preserve opaque handoff data without admitting it as a transfer', async context => {
	const opaque = { [CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY]: { kind: 'future-handoff', version: 99 } };
	const { controller, file } = await fixture(context, opaque);
	await controller.actions.project.openScapeFile(file, () => assert.fail('An unchanged opaque extension must resume.'));
	assert.deepEqual(controller.project?.opaqueExtensions, opaque);
});

test('pending edits are flushed before reuse and a stale archive still requires a collision decision', async context => {
	const { controller, store, project, file } = await fixture(context);
	await controller.actions.project.rename('Newer work');
	const decisions: string[] = [];
	const result = await controller.actions.project.openScapeFile(file, request => { decisions.push(request.kind); return 'cancel'; });
	assert.deepEqual(result, { cancelled: true });
	assert.deepEqual(decisions, ['collision']);
	assert.equal(controller.project?.title, 'Newer work');
	assert.equal((await store.loadProject(project.id))?.title, 'Newer work');
});

test('a genuine collision still offers a separate copy without overwriting the newer project', async context => {
	const { controller, store, project, file } = await fixture(context);
	await controller.actions.project.rename('Newer work');
	await controller.actions.project.save();
	await controller.actions.project.openScapeFile(file, request => { assert.equal(request.kind, 'collision'); return 'copy'; });
	assert.notEqual(controller.project?.id, project.id);
	assert.equal((await store.loadProject(project.id))?.title, 'Newer work');
	assert.equal(controller.project?.title, 'LP side A copy');
});

test('a matching project document never bypasses verification of damaged archive audio', async context => {
	const { controller, store, project, file, source } = await fixture(context);
	const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
	const audio = Object.entries(entries).find(([name]) => name !== 'project.json' && name !== 'manifest.json');
	assert.ok(audio);
	audio[1][audio[1].length - 1]! ^= 0x20;
	const damaged = makeStoredZip(Object.entries(entries).map(([name, data]) => ({ name, data })));
	const decisions: string[] = [];
	assert.deepEqual(await controller.actions.project.openScapeFile(new File([damaged], 'Damaged.sscape'), request => {
		decisions.push(request.kind); return 'cancel';
	}), { cancelled: true });
	assert.deepEqual(decisions, ['recovery']);
	assert.equal(controller.project?.id, project.id);
	assert.deepEqual(await readPcm(store, source.storageKey), [[0.5, -0.5, 0.25, -0.25]]);
});

test('different valid archive audio under the same source identity still requires a collision decision', async context => {
	const { controller, store, project, runtime, source } = await fixture(context);
	const alternateStore = { ...store,
		loadProject: store.loadProject.bind(store),
		async *readSourceChunks() { yield { channels: [Float32Array.from([-0.5, 0.5, -0.25, 0.25])] }; },
	};
	const archive = await runtime.exportScapeProject(project, alternateStore);
	assert.ok(archive.blob);
	const decisions: string[] = [];
	assert.deepEqual(await controller.actions.project.openScapeFile(new File([archive.blob], 'Other audio.sscape'), request => {
		decisions.push(request.kind); return 'cancel';
	}), { cancelled: true });
	assert.deepEqual(decisions, ['collision']);
	assert.deepEqual(await readPcm(store, source.storageKey), [[0.5, -0.5, 0.25, -0.25]]);
});
