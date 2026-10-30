/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createIncrementalHistoryRoots, createSessionRetentionIndex } from '../src/common/editor/session-retention-index.ts';

test('cold history admission shares one clip and assistance traversal per owned project', () => {
	let clipReads = 0;
	let assistanceReads = 0;
	const countedClip = (id: string) => Object.freeze({ get id() { clipReads++; return id; } });
	const documents = Array.from({ length: 200 }, (_, snapshot) => Object.freeze({
		clips: Object.freeze(Array.from({ length: 1_000 }, (_, clip) => countedClip(`clip-${String(clip)}`))),
		projectBin: Object.freeze({ clips: Object.freeze(Array.from({ length: 100 }, (_, clip) => countedClip(`bin-${String(clip)}`))) }),
		assistanceAssets: Object.freeze([{ get sourceId() { assistanceReads++; return `assistance-${String(snapshot)}`; } }]),
	}));
	const first = documents[199]!;
	const initial = { present: first, undoStack: documents.slice(0, -1).map(project => ({ project })) };
	const index = createSessionRetentionIndex(initial);
	assert.equal(clipReads, 0, 'optional views must stay lazy');
	const roots = index.getRetentionRoots();
	assert.equal(roots.clipIds.size, 1_100);
	assert.equal(roots.assistanceSourceIds.size, 200);
	assert.equal(clipReads, 220_000, 'the two views must share their cold project scan');
	assert.equal(assistanceReads, 600, 'one collector performs three validated sourceId reads per asset');

	index.getRetentionRoots();
	index.update({ present: documents[198]!, undoStack: initial.undoStack.slice(0, -1), redoStack: [{ project: first }] });
	assert.deepEqual(index.getRetentionRoots(), roots);
	assert.equal(clipReads, 220_000, 'undo and repeated reads reuse admitted projections');
	const next = Object.freeze({ clips: Object.freeze([countedClip('new-clip')]), assistanceAssets: Object.freeze([{ sourceId: 'new-assistance' }]) });
	index.update({ present: next, undoStack: documents.map(project => ({ project })) });
	assert.equal(index.getRetentionRoots().clipIds.size, 1_101);
	assert.equal(clipReads, 220_001, 'only the entering snapshot is scanned');
	roots.clipIds.clear();
	roots.assistanceSourceIds.clear();
	assert.equal(index.getRetentionRoots().assistanceSourceIds.size, 201, 'public sets remain detached');
});

test('paired admission reuses privately owned root Sets without retaining duplicate entries', () => {
	const OriginalSet = globalThis.Set;
	let copiedEntries = 0;
	globalThis.Set = new Proxy(OriginalSet, {
		construct(target, args, newTarget) {
			const values: unknown = args[0];
			if (values instanceof OriginalSet && (values.has('clip') || values.has('assistance'))) copiedEntries += values.size;
			return Reflect.construct(target, args, newTarget) as Set<unknown>;
		},
	});
	try {
		const index = createSessionRetentionIndex({ present: { clips: [{ id: 'clip' }], assistanceAssets: [{ sourceId: 'assistance' }] } });
		assert.deepEqual(index.getRetentionRoots(), { clipIds: new OriginalSet(['clip']), assistanceSourceIds: new OriginalSet(['assistance']) });
		assert.equal(copiedEntries, 0, 'one pair of root sets must serve both collection and incremental ownership');
	} finally { globalThis.Set = OriginalSet; }
});

test('generic collectors still detach mutable root Sets before indexing', () => {
	const roots = new Set(['original']);
	const index = createIncrementalHistoryRoots({ present: {} }, () => roots);
	roots.clear();
	roots.add('later');
	assert.deepEqual(index.getRoots(), new Set(['original']));
});

test('shared paired projections release retired project records while the index remains alive', () => {
	const moduleUrl = new URL('../src/common/editor/session-retention-index.ts', import.meta.url).href;
	const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '--eval', `
		import assert from 'node:assert/strict';
		import { createSessionRetentionIndex } from ${JSON.stringify(moduleUrl)};
		let retired = Object.freeze({ clips: Object.freeze([{ id: 'retired' }]), assistanceAssets: Object.freeze([{ sourceId: 'retired-source' }]), opaque: { payload: new Uint8Array(1024 * 1024) } });
		const projectRef = new WeakRef(retired);
		const payloadRef = new WeakRef(retired.opaque);
		const index = createSessionRetentionIndex({ present: retired });
		index.getRetentionRoots();
		index.update({ present: Object.freeze({ clips: [], assistanceAssets: [] }) });
		index.getRetentionRoots();
		retired = null;
		for (let attempt = 0; attempt < 20; attempt++) {
			await new Promise(resolve => setImmediate(resolve));
			globalThis.gc();
			await new Promise(resolve => setImmediate(resolve));
			if (!projectRef.deref() && !payloadRef.deref()) break;
		}
		assert.equal(projectRef.deref(), undefined);
		assert.equal(payloadRef.deref(), undefined);
		assert.equal(index.getRetentionRoots().clipIds.size, 0);
	`], { encoding: 'utf8', timeout: 30_000 });
	assert.equal(result.status, 0, result.stderr || result.stdout);
});
