/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readSubprojectLinks, subprojectContentDigest } from '../src/common/editor/subprojects.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject, validateSoundscaperProject, type SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { readSessionSnapshots, snapshotProjectState } from '../src/common/editor/session-snapshots.ts';
import { collectProjectSourceIds } from '../src/common/editor/retention.js';

const NOW = '2026-11-16T12:00:00.000Z';
function source(id: string) { return { id, kind: 'audio', name: 'Child mix', sampleRate: 48000, channelCount: 1, frameCount: 4, storageKey: id }; }
function fixture() {
	return createSoundscaperProject({ id: 'parent', now: NOW, sources: [source('proxy-1')],
		tracks: [{ id: 'track', type: 'audio', name: 'Child', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'proxy-1', timelineStartFrame: 12, sourceStartFrame: 1, durationFrames: 2 }],
	});
}
const link = { id: 'link', projectId: 'child', libraryId: 'library', title: 'Scene', sourceId: 'proxy-1',
	followLatest: true, revision: 1, contentDigest: 'a'.repeat(64), sampleRate: 48000, channelCount: 1, frameCount: 4 } as const;
const install = { type: 'subproject/install', expected: null, link, source: source('proxy-1') } as const;

test('subproject installation and refresh preserve placement and named snapshot media', () => {
	let project = applySoundscaperProjectCommand(fixture(), install);
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-create', id: 'snapshot', name: 'Original', createdAt: NOW });
	const updated = { ...link, sourceId: 'proxy-2', revision: 2, contentDigest: 'b'.repeat(64) };
	project = applySoundscaperProjectCommand(project, { type: 'subproject/install', expected: link, link: updated, source: source('proxy-2') });
	assert.deepEqual(project.clips.map(clip => [clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames, clip.sourceId]), [[12, 1, 2, 'proxy-2']]);
	const snapshot = snapshotProjectState(project, readSessionSnapshots(project)[0]!);
	assert.equal(snapshot.clips instanceof Array && snapshot.clips[0].sourceId, 'proxy-1');
	assert.equal(readSubprojectLinks(snapshot)[0]!.revision, 1);
	assert.deepEqual([...collectProjectSourceIds(project)].sort(), ['proxy-1', 'proxy-2']);
	assert.equal(readSubprojectLinks(project)[0]!.revision, 2);
	const detached = applySoundscaperProjectCommand(project, { type: 'subproject/detach', expected: readSubprojectLinks(project)[0]! });
	assert.ok(detached.featureRequirements.requirements.some(row => row.featureId === 'org.soundscaper.capability.subprojects'));
	const withoutSnapshot = applySoundscaperProjectCommand(detached, { type: 'project/snapshot-remove', id: 'snapshot' });
	assert.equal(withoutSnapshot.featureRequirements.requirements.some(row => row.featureId === 'org.soundscaper.capability.subprojects'), false);
});

test('proxy refresh is undoable and rejects obsolete results and changing source geometry', () => {
	let history = createSoundscaperProjectHistory(fixture());
	history = executeSoundscaperProjectCommand(history, install);
	history = executeSoundscaperProjectCommand(history, { type: 'subproject/install', expected: link,
		link: { ...link, revision: 2, sourceId: 'proxy-2' }, source: source('proxy-2') });
	assert.equal(undoSoundscaperProjectCommand(history).present.clips[0]!.sourceId, 'proxy-1');
	assert.throws(() => applySoundscaperProjectCommand(history.present, { ...install, expected: link }), /changed|current|obsolete/iu);
	assert.throws(() => applySoundscaperProjectCommand(history.present, { type: 'subproject/install',
		expected: readSubprojectLinks(history.present)[0]!, link: { ...link, frameCount: 8, sourceId: 'proxy-3' },
		source: { ...source('proxy-3'), frameCount: 8 } }), /geometry|range/iu);
});

test('follow mode and detach use exact current links and leave the rendered clip playable', () => {
	let project = applySoundscaperProjectCommand(fixture(), install);
	project = applySoundscaperProjectCommand(project, { type: 'subproject/follow', expected: link, followLatest: false });
	assert.equal(readSubprojectLinks(project)[0]!.followLatest, false);
	project = applySoundscaperProjectCommand(project, { type: 'subproject/detach', expected: readSubprojectLinks(project)[0]! });
	assert.deepEqual(readSubprojectLinks(project), []);
	assert.equal(project.clips[0]!.sourceId, 'proxy-1');
	assert.equal(project.sources[0]!.storageKey, 'proxy-1');
});

test('link validation rejects self links, duplicate proxy ownership, missing media and invalid provenance', () => {
	const project = applySoundscaperProjectCommand(fixture(), install);
	for (const changes of [{ projectId: 'parent' }, { contentDigest: 'broken' }, { revision: -1 }, { frameCount: 5 }]) {
		const malformed = structuredClone(project);
		Object.assign((malformed.metadata as Record<string, unknown>).subprojects instanceof Array
			? ((malformed.metadata as Record<string, unknown>).subprojects as object[])[0]! : {}, changes);
		assert.throws(() => validateSoundscaperProject(malformed));
	}
	const missing = structuredClone(project);
	(missing as unknown as Record<string, unknown>).sources = [];
	assert.throws(() => validateSoundscaperProject(missing));
	assert.throws(() => applySoundscaperProjectCommand(project, { ...install, link: { ...link, id: 'other' } }), /proxy|source/iu);
});

test('render identities ignore selection and named snapshots but include audible state and nested output', () => {
	const project = fixture();
	const digest = subprojectContentDigest(project);
	assert.equal(subprojectContentDigest({ ...project, selection: { startFrame: 1, endFrame: 2 }, updatedAt: 'later' }), digest);
	assert.equal(subprojectContentDigest({ ...project, metadata: { ...project.metadata, sessionSnapshots: [] } }), digest);
	assert.notEqual(subprojectContentDigest({ ...project, master: { ...project.master, gain: 0.25 } }), digest);
	assert.notEqual(subprojectContentDigest(project, ['b'.repeat(64)]), subprojectContentDigest(project, ['c'.repeat(64)]));
});

test('subproject metadata and render identity inspection never invoke accessors', () => {
	let invoked = false;
	const getter = () => { invoked = true; return []; };
	assert.throws(() => readSubprojectLinks({ metadata: Object.defineProperty({}, 'subprojects', { enumerable: true, get: getter }) }), /data property/iu);
	assert.throws(() => subprojectContentDigest({ metadata: {}, master: Object.defineProperty({}, 'gain', { enumerable: true, get: getter }) }), /data property/iu);
	assert.equal(invoked, false);
});

test('portable proxy audio survives a fresh library and source-ID collisions without retargeting the child link', async context => {
	const { createSoundscaperEphemeralProjectStore } = await import('../src/soundscaper/editor-project-store.ts');
	const { createSoundscaperScapeNativeRuntime } = await import('../src/soundscaper/editor-scape-native.ts');
	const sender = createSoundscaperEphemeralProjectStore(), recipient = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await sender.close(); await recipient.close(); });
	const pcm = new Float32Array([0.25, -0.5, 0.75, 0]);
	for (const store of [sender, recipient]) {
		const writer = await store.beginSourceWrite('proxy-1', { sampleRate: 48000, channelCount: 1 });
		await writer.write([store === sender ? pcm : new Float32Array(4)]); await writer.commit();
	}
	let project = applySoundscaperProjectCommand(fixture(), install);
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-create', id: 'snapshot', name: 'Linked state', createdAt: NOW });
	const runtime = createSoundscaperScapeNativeRuntime();
	const archive = await runtime.exportScapeProject(project, sender);
	assert.ok(archive.blob);
	const imported = await runtime.importScapeProject(archive.blob, recipient);
	const reopened = await recipient.loadProject(imported.project.id) as SoundscaperProject | null;
	assert.ok(reopened);
	const portable = readSubprojectLinks(reopened)[0]!;
	assert.notEqual(portable.sourceId, 'proxy-1');
	assert.equal(portable.sourceId, reopened.clips[0]!.sourceId);
	assert.equal(portable.projectId, 'child');
	assert.equal(portable.libraryId, 'library');
	const snapshot = snapshotProjectState(reopened, readSessionSnapshots(reopened)[0]!);
	assert.equal(readSubprojectLinks(snapshot)[0]!.sourceId, portable.sourceId);
	const audio = [];
	for await (const chunk of recipient.readSourceChunks(String(reopened.sources[0]!.storageKey))) audio.push(chunk.channels[0]);
	assert.deepEqual(audio, [pcm]);
});
