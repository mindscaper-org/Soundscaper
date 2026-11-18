/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSubprojectRenderer } from '../src/common/editor/controller/document/internal/subprojects/subproject-renderer.ts';
import { resolveSubprojectGraph } from '../src/common/editor/controller/document/internal/subprojects/subproject-graph.ts';
import { createSubprojectActions, type SubprojectDocument } from '../src/common/editor/controller/document/subproject-actions.ts';
import { readSubprojectLinks } from '../src/common/editor/subprojects.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import type { EngineLoadProjectOptions } from '../src/common/editor/engine/public-api.ts';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';

async function fixture(context: TestContext, hooks: {
	discard?: (source: StorageRecord) => void;
	abort?: () => void;
	dispose?: () => void;
} = {}) {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const writer = await store.beginSourceWrite('original', { sampleRate: 48000, channelCount: 1 });
	await writer.write([new Float32Array([0.25, -0.5])]); await writer.commit();
	const child = createSoundscaperProject({ id: 'child', sampleRate: 48000, masterChannels: 1,
		sources: [{ id: 'original', kind: 'audio', name: 'Input', sampleRate: 48000, channelCount: 1, frameCount: 2, storageKey: 'original' }],
		tracks: [{ id: 'track', type: 'audio', name: 'Voice', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'original', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 2 }],
	}) as SubprojectDocument;
	let serial = 0, disposed = 0, failed = false, pcmCopies = 0;
	const renderStore = {
		readSourceChunk: store.readSourceChunk.bind(store),
		getSourceMetadata: store.getSourceMetadata.bind(store),
		openSourceReadSession: store.openSourceReadSession.bind(store),
		async beginSourceWrite(id: string, metadata: Record<string, unknown>) {
			const writer = await store.beginSourceWrite(id, metadata);
			return { ...writer, async abort() { await writer.abort(); hooks.abort?.(); } };
		},
		sourceRepository: { discardIfCurrent(source: StorageRecord) {
			hooks.discard?.(source);
			return store.sourceRepository.discardIfCurrent(source);
		} },
	};
	const renderer = createSubprojectRenderer({ store: renderStore, createId: prefix => `${prefix}-${String(++serial)}`,
		preflight: () => Promise.resolve(), projectForRuntimeConsumers: project => { validateSoundscaperProject(project); return projectForRuntimeConsumers(project); },
		createEngine: () => {
			let inputs: EngineLoadProjectOptions | undefined;
			let sourceId = '';
			return { loadProject(project, _buffers, options) { inputs = options; sourceId = String(project?.clips?.[0]?.sourceId); },
				async renderMixToSink(options = {}) {
					assert.equal(options.includeMaster, true); assert.equal(options.respectMuteSolo, true);
					assert.ok(options.chunkFrames && options.chunkFrames >= 128 && options.chunkFrames <= 16384);
					const providers = inputs?.chunkSources as ReadonlyMap<string, EngineChunkSource>;
					const chunk = await providers.get(sourceId)!.readStorageChunk(0);
					const channels = Array.isArray(chunk) ? chunk as readonly Float32Array[] : (chunk as { channels: readonly Float32Array[] }).channels;
					assert.equal(typeof options.sink, 'function');
					const packet = channels.map(channel => {
						const copy = new Float32Array(channel);
						const slice = copy.slice.bind(copy);
						copy.slice = (start, end) => { pcmCopies++; return slice(start, end); };
						return copy;
					});
					if (typeof options.sink === 'function') await options.sink(packet, { sampleRate: 48000 });
					for (const channel of packet) channel.fill(0);
					if (failed) throw new Error('render failed');
					return { sampleRate: 48000, channelCount: 1, frameCount: 2, chunkCount: 1 };
				}, dispose() { disposed++; hooks.dispose?.(); },
			};
		},
	});
	return { store, child, renderer, disposed: () => disposed, pcmCopies: () => pcmCopies, fail() { failed = true; } };
}

test('the proxy renderer uses stored PCM, retains a fixed publication range, and cleans up only its own stage', async context => {
	const f = await fixture(context);
	const node = await resolveSubprojectGraph('child', 'library', () => Promise.resolve(f.child));
	const output = await f.renderer.render(node, { sampleRate: 48000, channelCount: 1, frameCount: 4 });
	const chunks = [];
	for await (const chunk of f.store.readSourceChunks(String(output.source.storageKey))) chunks.push(chunk.channels[0]);
	assert.deepEqual(chunks, [new Float32Array([0.25, -0.5, 0, 0])]);
	assert.equal(f.pcmCopies(), 0);
	assert.equal(f.disposed(), 1);
	await output.discard();
	assert.equal(await f.store.getSourceMetadata(String(output.source.storageKey)), null);
	assert.ok(await f.store.getSourceMetadata('original'));
});

test('render failures abort partial PCM without publishing a proxy or deleting original media', async context => {
	const f = await fixture(context); f.fail();
	const node = await resolveSubprojectGraph('child', 'library', () => Promise.resolve(f.child));
	await assert.rejects(f.renderer.render(node, { sampleRate: 48000, channelCount: 1, frameCount: 4 }), /render failed/u);
	assert.equal(f.disposed(), 1);
	assert.deepEqual((await f.store.listSources()).map(source => source.id), ['original']);
});

test('an unavailable new child recording leaves the saved parent mix usable until it is restored', async context => {
	const f = await fixture(context);
	let parent = createSoundscaperProject({ id: 'parent', sampleRate: 48000 }) as SubprojectDocument;
	let child = f.child;
	let serial = 0;
	const actions = createSubprojectActions({ ...f.renderer, getProject: () => parent, assertWritable() {},
		loadProject: id => Promise.resolve(id === child.id ? child : null),
		listProjects: () => Promise.resolve([parent, child]), getLibraryId: () => Promise.resolve('library'),
		commit: command => { parent = applySoundscaperProjectCommand(parent, command) as SubprojectDocument; },
		createId: prefix => `${prefix}-${String(++serial)}`, openProject: id => Promise.resolve(id),
		prepare: () => Promise.resolve(), reportError: error => { throw error; }, wait: () => Promise.resolve(),
	});
	await actions.add(child.id);
	const [installed] = readSubprojectLinks(parent);
	assert.ok(installed);
	child = applySoundscaperProjectCommand(child, { type: 'batch', commands: [
		{ type: 'source/add', source: { ...child.sources[0]!, id: 'new-recording', storageKey: 'new-recording' } },
		{ type: 'clip/replace-source', clipId: 'clip', sourceId: 'new-recording' },
	] }) as SubprojectDocument;
	await actions.refresh();
	assert.deepEqual(readSubprojectLinks(parent)[0], installed);
	assert.ok(await f.store.getSourceMetadata(installed.sourceId));
	await assert.rejects(actions.refresh({ force: true }), /source media is missing/u);
	const writer = await f.store.beginSourceWrite('new-recording', { sampleRate: 48000, channelCount: 1 });
	await writer.write([new Float32Array([0.5, 0.75])]); await writer.commit();
	await actions.refresh();
	assert.notEqual(readSubprojectLinks(parent)[0]?.sourceId, installed.sourceId);
});

test('a failed PCM abort still releases the subproject engine and retains the render error', async context => {
	const abortFailure = new Error('proxy writer abort failed');
	const f = await fixture(context, { abort() { throw abortFailure; } }); f.fail();
	const node = await resolveSubprojectGraph('child', 'library', () => Promise.resolve(f.child));
	await assert.rejects(f.renderer.render(node, { sampleRate: 48000, channelCount: 1, frameCount: 4 }),
		(error: unknown) => error instanceof AggregateError && error.errors.some(cause => cause === abortFailure)
			&& error.errors.some(cause => cause instanceof Error && cause.message === 'render failed'));
	assert.equal(f.disposed(), 1);
});

test('a failed engine teardown retires its already written but unpublished proxy', async context => {
	const teardown = new Error('subproject engine disposal failed');
	const f = await fixture(context, { dispose() { throw teardown; } });
	const node = await resolveSubprojectGraph('child', 'library', () => Promise.resolve(f.child));
	await assert.rejects(f.renderer.render(node, { sampleRate: 48000, channelCount: 1, frameCount: 2 }),
		(error: unknown) => error === teardown);
	assert.deepEqual((await f.store.listSources()).map(source => source.id), ['original']);
});

test('nested rendering uses current descendant PCM through valid temporary sources without rewriting the saved parent', async context => {
	const f = await fixture(context);
	const original = f.child.sources[0]!;
	const middle = applySoundscaperProjectCommand({ ...f.child, id: 'middle' }, { type: 'subproject/install', expected: null,
		source: original, link: { id: 'link', projectId: 'child', libraryId: 'library', title: 'Child', sourceId: 'original',
			followLatest: true, revision: 0, contentDigest: 'a'.repeat(64), sampleRate: 48000, channelCount: 1, frameCount: 2 } }) as SubprojectDocument;
	const writer = await f.store.beginSourceWrite('changed', { sampleRate: 48000, channelCount: 1 });
	await writer.write([new Float32Array([-0.25, 0.125])]); await writer.commit();
	const child = applySoundscaperProjectCommand(f.child, { type: 'batch', commands: [
		{ type: 'source/add', source: { ...original, id: 'changed', storageKey: 'changed' } },
		{ type: 'clip/replace-source', clipId: 'clip', sourceId: 'changed' },
	] }) as SubprojectDocument;
	const documents = new Map([['middle', middle], ['child', child]]);
	const node = await resolveSubprojectGraph('middle', 'library', id => Promise.resolve(documents.get(id) ?? null));
	const output = await f.renderer.render(node, { sampleRate: 48000, channelCount: 1, frameCount: 2 });
	const chunks = [];
	for await (const chunk of f.store.readSourceChunks(String(output.source.storageKey))) chunks.push(chunk.channels[0]);
	assert.deepEqual(chunks, [new Float32Array([-0.25, 0.125])]);
	assert.equal(middle.sources[0]!.storageKey, 'original');
	assert.deepEqual((await f.store.listSources()).map(source => source.id).sort(), ['changed', 'original', output.source.id].sort());
});

test('nested links share identical child output while other geometries render independently', async context => {
	const f = await fixture(context);
	let parent = { ...f.child, id: 'parent' };
	for (const [sourceId, frameCount] of [['original', 2], ['second', 2], ['longer', 4]] as const) {
		const source = { ...f.child.sources[0]!, id: sourceId, storageKey: sourceId, frameCount };
		parent = applySoundscaperProjectCommand(parent, { type: 'subproject/install', expected: null, source,
			link: { id: `link-${sourceId}`, projectId: f.child.id, libraryId: 'library', title: f.child.title, sourceId,
				followLatest: true, revision: 0, contentDigest: 'a'.repeat(64), sampleRate: 48000, channelCount: 1, frameCount },
		}) as SubprojectDocument;
	}
	const node = await resolveSubprojectGraph(parent.id, 'library', id => Promise.resolve(id === parent.id ? parent : f.child));
	const output = await f.renderer.render(node, { sampleRate: 48000, channelCount: 1, frameCount: 2 });
	const pcm = [];
	for await (const chunk of f.store.readSourceChunks(String(output.source.storageKey))) pcm.push(chunk.channels[0]);
	assert.deepEqual(pcm, [new Float32Array([0.25, -0.5])]);
	assert.equal(f.disposed(), 3);
	assert.deepEqual((await f.store.listSources()).map(source => source.id).sort(), ['original', output.source.id].sort());
});

test('failed retirement of one child proxy still retires its sibling and their unpublished parent', async context => {
	const failed = new Error('one child proxy could not be removed');
	const attempted: unknown[] = [];
	const f = await fixture(context, { discard(source) {
		attempted.push(source.id);
		if (source.id === 'subproject-audio-2') throw failed;
	} });
	let parent = { ...f.child, id: 'parent' };
	for (const [sourceId, frameCount] of [['original', 2], ['longer', 4]] as const) {
		const source = { ...f.child.sources[0]!, id: sourceId, storageKey: sourceId, frameCount };
		parent = applySoundscaperProjectCommand(parent, { type: 'subproject/install', expected: null, source,
			link: { id: `link-${sourceId}`, projectId: f.child.id, libraryId: 'library', title: f.child.title, sourceId,
				followLatest: true, revision: 0, contentDigest: 'a'.repeat(64), sampleRate: 48000, channelCount: 1, frameCount },
		}) as SubprojectDocument;
	}
	const node = await resolveSubprojectGraph(parent.id, 'library', id => Promise.resolve(id === parent.id ? parent : f.child));
	await assert.rejects(f.renderer.render(node, { sampleRate: 48000, channelCount: 1, frameCount: 2 }),
		(error: unknown) => error === failed);
	assert.deepEqual(attempted, ['subproject-audio-2', 'subproject-audio-1', 'subproject-audio-3']);
	assert.deepEqual((await f.store.listSources()).map(source => source.id).sort(), ['original', 'subproject-audio-2']);
});
