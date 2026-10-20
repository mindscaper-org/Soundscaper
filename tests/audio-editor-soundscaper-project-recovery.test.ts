/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { inspectSoundscaperProjectRecovery, createSoundscaperProjectRecoveryCopy } from '../src/soundscaper/editor-project-recovery-service.ts';
import { repairSoundscaperProject } from '../src/soundscaper/editor-project-recovery-repair.ts';
import { ProjectCommittedMaintenanceError } from '../src/common/editor/storage/project-committed-maintenance-error.ts';
import { SoundscaperDesktopProjectLibraryCommittedError } from '../src/soundscaper/desktop-project-library-renderer-catalog.ts';

const NOW = '2026-10-08T12:00:00.000Z';

function fixture(id: string) {
	const source = createAudioSource({ id: `${id}-source`, frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: `${id}-clip`, sourceId: source.id, durationFrames: 4 });
	const track = createAudioTrack({ id: `${id}-track`, clipIds: [clip.id] });
	return createSoundscaperProject({ id, now: NOW, sampleRate: 48_000, sources: [source], clips: [clip], tracks: [track] });
}

test('repair retains valid audio and drops missing clips, broken effects and dangling state', () => {
	const original = fixture('repair');
	const corrupt = structuredClone(original) as unknown as Record<string, unknown>;
	const tracks = corrupt.tracks as Record<string, unknown>[];
	tracks[0]!.effects = [{ id: 'broken', type: 'parametric-eq', parameters: null }];
	tracks[0]!.clipIds = ['repair-clip', 'absent'];
	corrupt.selection = { ...(corrupt.selection as object), clipIds: ['absent'] };
	corrupt.metadata = { malformed: true };
	const repaired = repairSoundscaperProject(corrupt, new Set(['repair-source']));
	validateSoundscaperProject(repaired.project);
	assert.equal(repaired.project.clips.length, 1);
	assert.equal(repaired.project.sources.length, 1);
	assert.deepEqual(repaired.project.tracks[0]?.clipIds, ['repair-clip']);
	assert.deepEqual(repaired.project.tracks[0]?.effects, []);
	assert.ok(repaired.changes.some(({ path }) => path.includes('effects')));
	assert.deepEqual((corrupt.tracks as Record<string, unknown>[])[0]!.clipIds, ['repair-clip', 'absent']);
});

test('repair refuses foreign or newer schemas and removes media that cannot be read', () => {
	const original = fixture('missing');
	assert.throws(() => repairSoundscaperProject({ ...original, schemaFamily: 'framescaper' }, new Set()));
	assert.throws(() => repairSoundscaperProject({ ...original, schemaVersion: 99 }, new Set()));
	const repaired = repairSoundscaperProject(original, new Set());
	validateSoundscaperProject(repaired.project);
	assert.equal(repaired.project.sources.length, 0);
	assert.equal(repaired.project.clips.length, 0);
	assert.ok(repaired.changes.some(({ path }) => path.startsWith('sources')));
});

test('repair resets a malformed track control while retaining its identity and valid timeline audio', () => {
	const original = fixture('repair-control');
	const corrupt = structuredClone(original) as unknown as Record<string, unknown>;
	(corrupt.tracks as Record<string, unknown>[])[0]!.gain = -999;
	const repaired = repairSoundscaperProject(corrupt, new Set(['repair-control-source']));
	validateSoundscaperProject(repaired.project);
	assert.equal(repaired.project.tracks[0]?.id, original.tracks[0]?.id);
	assert.equal(repaired.project.clips[0]?.id, original.clips[0]?.id);
	assert.equal(repaired.project.tracks[0]?.gain, 1);
	assert.ok(repaired.changes.some(({ path }) => path.includes('gain')));
});

test('repair preserves valid bin media, folder routing and mixer automation through damaged metadata', () => {
	const base = fixture('repair-graph');
	const original = createSoundscaperProject({
		...base, mixer: undefined, primarySequenceId: 'graph-sequence',
		trackFolders: [{ id: 'dialogue', name: 'Dialogue' }],
		sequences: [{ id: 'graph-sequence', trackNodes: [
			{ kind: 'folder', id: 'dialogue', parentFolderId: null },
			{ kind: 'track', id: 'repair-graph-track', parentFolderId: 'dialogue' },
		] }],
		projectBin: { clips: [createAudioClip({ id: 'graph-bin', sourceId: 'repair-graph-source', durationFrames: 4 })] },
		automationLanes: [{
			id: 'group-gain', address: { kind: 'strip', strip: { kind: 'mixer-node', id: 'dialogue' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'group-start', position: 0, value: 0.5 }], segments: [],
		}],
	});
	const corrupt = { ...structuredClone(original), metadata: { malformed: true } };
	const repaired = repairSoundscaperProject(corrupt, new Set(['repair-graph-source']));
	validateSoundscaperProject(repaired.project);
	assert.deepEqual(repaired.project.projectBin, original.projectBin);
	assert.deepEqual(repaired.project.trackFolders, original.trackFolders);
	assert.deepEqual(repaired.project.sequences, original.sequences);
	assert.deepEqual(repaired.project.mixer, original.mixer);
	assert.deepEqual(repaired.project.automationLanes, original.automationLanes);
	const brokenMixer = structuredClone(corrupt);
	(brokenMixer.mixer.groups as unknown as Record<string, unknown>[])[0]!.gain = -999;
	const rebuiltMixer = repairSoundscaperProject(brokenMixer, new Set(['repair-graph-source']));
	assert.deepEqual(rebuiltMixer.project.trackFolders, original.trackFolders);
	assert.deepEqual(rebuiltMixer.project.sequences, original.sequences);
	assert.deepEqual(rebuiltMixer.project.automationLanes, original.automationLanes);
});

test('recovery bypasses corrupt current loading, restores retained revision as a copy, and rejects forged receipts', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const good = createSoundscaperProject({ id: 'recovery-history', title: 'Saved work', now: NOW });
	await store.saveProject(good);
	const corrupt = { ...good, revision: 2, tracks: 'broken' };
	store.memory.projects.set(good.id, corrupt);
	await assert.rejects(store.loadProject(good.id));
	const inspection = await inspectSoundscaperProjectRecovery(store, good.id);
	const usableIndex = inspection.candidates.findIndex(({ status }) => status === 'usable');
	assert.ok(usableIndex >= 0);
	const result = await createSoundscaperProjectRecoveryCopy(store, inspection, usableIndex);
	validateSoundscaperProject(result.project);
	assert.notEqual(result.project.id, good.id);
	assert.equal(result.project.revision, 0);
	assert.deepEqual(store.memory.projects.get(good.id), corrupt);
	assert.ok(await store.loadProject(result.project.id));
	await assert.rejects(createSoundscaperProjectRecoveryCopy(store, { ...inspection }, usableIndex), /inspection/iu);
});

test('healthy project listing survives a damaged sibling while raw summaries still include it', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const good = createSoundscaperProject({ id: 'recovery-healthy', now: NOW });
	await store.saveProject(good);
	store.memory.projects.set('recovery-broken', { id: 'recovery-broken', title: null, schemaFamily: 'soundscaper', schemaVersion: 1 });
	assert.ok((await store.listProjects()).some(({ id }) => id === good.id));
	assert.ok((await store.listProjectRecoverySummaries()).some(({ id }) => id === 'recovery-broken'));
});

test('recovery retains one committed copy when browser or native maintenance fails after publication', async (context) => {
	for (const native of [false, true]) {
		const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
		context.after(async () => { await store.close(); });
		const original = createSoundscaperProject({ id: `recovery-committed-${String(native)}`, now: NOW });
		await store.saveProject(original);
		const inspection = await inspectSoundscaperProjectRecovery(store, original.id);
		const create = store.createProjectIfAbsent.bind(store);
		let publications = 0;
		store.createProjectIfAbsent = async (copy) => {
			publications += 1;
			const committed = await create(copy);
			assert.ok(committed);
			if (native) throw new SoundscaperDesktopProjectLibraryCommittedError('publication', copy.id, new Error('Shadow unavailable'));
			throw new ProjectCommittedMaintenanceError(committed, new Error('Revision maintenance unavailable'));
		};
		const result = await createSoundscaperProjectRecoveryCopy(store, inspection, 0);
		assert.equal(publications, 1);
		assert.notEqual(result.project.id, original.id);
		assert.deepEqual(await store.loadProject(result.project.id), result.project);
		assert.deepEqual(await store.loadProject(original.id), original);
	}
});

test('an indeterminate native publication retry resolves the same copy without publishing again', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const original = createSoundscaperProject({ id: 'recovery-indeterminate', now: NOW });
	await store.saveProject(original);
	const inspection = await inspectSoundscaperProjectRecovery(store, original.id);
	const create = store.createProjectIfAbsent.bind(store);
	const read = store.readProjectRecoveryCandidates.bind(store);
	let verificationUnavailable = true;
	let publications = 0;
	store.readProjectRecoveryCandidates = async (id) => {
		if (id !== original.id && verificationUnavailable) throw new Error('Catalog temporarily unavailable');
		return read(id);
	};
	store.createProjectIfAbsent = async (copy) => {
		publications += 1;
		await create(copy);
		throw new SoundscaperDesktopProjectLibraryCommittedError('publication', copy.id, new Error('Shadow unavailable'));
	};
	await assert.rejects(createSoundscaperProjectRecoveryCopy(store, inspection, 0), /indeterminate/iu);
	verificationUnavailable = false;
	const result = await createSoundscaperProjectRecoveryCopy(store, inspection, 0);
	assert.equal(publications, 1);
	assert.ok(await store.loadProject(result.project.id));
	assert.deepEqual(await store.loadProject(original.id), original);
});

test('recovery validates PCM under its storage key and preserves the shared original body', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const original = fixture('recovery-storage-key');
	const source = { ...original.sources[0]!, storageKey: 'separate-pcm-key' };
	const project = createSoundscaperProject({ ...original, sources: [source] });
	await store.writeAudioBuffer(source.storageKey, {
		sampleRate: 48_000, numberOfChannels: 1, length: 4,
		getChannelData: () => Float32Array.of(0.125, 0.25, 0.375, 0.5),
	}, source);
	await store.saveProject(project);
	const inspection = await inspectSoundscaperProjectRecovery(store, project.id);
	assert.equal(inspection.candidates[0]!.status, 'usable');
	const restored = await createSoundscaperProjectRecoveryCopy(store, inspection, 0);
	assert.equal(restored.project.clips.length, 1);
	assert.equal(restored.project.sources[0]?.storageKey, source.storageKey);
	assert.ok(await store.getSourceMetadata(source.storageKey));
	assert.ok(await store.loadProject(project.id));
});

test('history-only projects remain discoverable and stale recovery inspections cannot publish', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const project = createSoundscaperProject({ id: 'history-only-recovery' });
	await store.saveProject(project);
	store.memory.projects.delete(project.id);
	assert.ok((await store.listProjectRecoverySummaries()).some(({ id }) => id === project.id));
	const inspection = await inspectSoundscaperProjectRecovery(store, project.id);
	const entry = [...store.memory.revisions.entries()].find(([, row]) => (row as { projectId?: string }).projectId === project.id);
	assert.ok(entry);
	const row = entry[1] as Record<string, unknown>;
	store.memory.revisions.set(entry[0], { ...row, project: { ...(row.project as object), title: 'Changed externally' } });
	await assert.rejects(createSoundscaperProjectRecoveryCopy(store, inspection, 0), /changed/iu);
	assert.equal(store.memory.projects.has(project.id), false);
});
