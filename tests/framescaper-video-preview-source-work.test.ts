/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoPreviewSourceMembership } from '../src/common/editor/video-preview-source-membership.ts';
import { createVideoPreviewTimelineState } from '../src/common/editor/ui/workspace/video-preview-timeline-state.js';

function preview(project: object, visual: (id: string) => object | null, missing = new Set<string>(), failed = new Map<string, string>()) {
	return createVideoPreviewTimelineState(project, {
		actions: { video: { getSourceVisualData: visual }, timeline: {} },
	}, missing, failed, {}, null, null, null, { resolveCompositionIntervals: () => [] });
}

test('large immutable video previews visit source membership once instead of once per clip', () => {
	const count = 2_000;
	const sources = Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({ id: `s${index}` })));
	const clips = Object.freeze(sources.map(({ id }, index) => Object.freeze({ kind: 'video', id: `c${index}`, sourceId: id })));
	const project = Object.freeze({ sources, clips });
	const some = Array.prototype.some;
	let sourceVisits = 0;
	Array.prototype.some = function (predicate, receiver) {
		return some.call(this, this === sources ? (value, index, values) => {
			sourceVisits++;
			return predicate.call(receiver, value, index, values);
		} : predicate, receiver);
	};
	let result: ReturnType<typeof preview>;
	try { result = preview(project, () => ({ url: 'blob:video' })); }
	finally { Array.prototype.some = some; }
	assert.equal(result.clipStateById.size, count);
	assert.ok([...result.clipStateById.values()].every(state => state.available));
	assert.ok(sourceVisits <= count, `${sourceVisits} source membership visits for ${count} clips`);
});

test('preview membership preserves proxy, missing-source, failed-URL and absent-source behavior', () => {
	const sources = Object.freeze(['ready', 'missing', 'proxy', 'failed'].map(id => Object.freeze({ id })));
	const clips = Object.freeze([...sources, { id: 'absent' }].map(({ id }) => Object.freeze({ kind: 'video', id, sourceId: id })));
	const result = preview(Object.freeze({ sources, clips }), id => ({ url: `blob:${id}`, ...(id === 'proxy' ? { mediaKind: 'proxy' } : {}) }),
		new Set(['missing', 'proxy']), new Map([['failed', 'blob:failed']]));
	assert.deepEqual([...result.clipStateById], [
		['ready', { available: true }], ['missing', { available: false }], ['proxy', { available: true }],
		['failed', { available: false }], ['absent', { available: false }],
	]);
});

test('mutable preview inventories stay live across visual-provider callbacks', () => {
	const project = { sources: [{ id: 'first' }], clips: [
		{ kind: 'video', id: 'a', sourceId: 'first' }, { kind: 'video', id: 'b', sourceId: 'second' },
	] };
	const result = preview(project, id => {
		project.sources = [{ id }];
		return { url: `blob:${id}` };
	});
	assert.deepEqual([...result.clipStateById.values()], [{ available: true }, { available: true }]);
});

test('frozen containers with mutable source identities retain live reads', () => {
	const source = { id: 'first' };
	const project = Object.freeze({ sources: Object.freeze([source]), clips: Object.freeze([
		{ kind: 'video', id: 'a', sourceId: 'first' }, { kind: 'video', id: 'b', sourceId: 'second' },
	]) });
	const result = preview(project, id => { source.id = id; return { url: `blob:${id}` }; });
	assert.deepEqual([...result.clipStateById.values()], [{ available: true }, { available: true }]);
});

test('custom source membership and source accessors remain observable', () => {
	let queries = 0;
	const sources = Object.freeze(Object.assign([{ id: 'source' }], { some() { queries++; return false; } }));
	const clips = [{ kind: 'video', id: 'clip', sourceId: 'source' }];
	assert.equal(preview(Object.freeze({ sources, clips }), () => ({ url: 'blob:source' })).clipStateById.get('clip')?.available, false);
	assert.equal(queries, 1);
	let reads = 0;
	const getterSource = Object.freeze({ get id() { reads++; return 'source'; } });
	assert.equal(preview(Object.freeze({ sources: Object.freeze([getterSource]), clips }), () => ({ url: 'blob:source' })).clipStateById.get('clip')?.available, true);
	assert.equal(reads, 1);
});


test('source membership preserves duplicate IDs, empty inventories and live project accessors', () => {
	const sources = Object.freeze([Object.freeze({ id: 'same' }), Object.freeze({ id: 'same' })]);
	const contains = createVideoPreviewSourceMembership(Object.freeze({ sources }));
	assert.equal(contains('same'), true);
	assert.equal(contains('missing'), false);
	assert.equal(createVideoPreviewSourceMembership(Object.freeze({}))('same'), false);
	let current = [{ id: 'first' }];
	const live = createVideoPreviewSourceMembership(Object.freeze({ get sources() { return current; } }));
	assert.equal(live('first'), true);
	current = [{ id: 'second' }];
	assert.equal(live('first'), false);
	assert.equal(live('second'), true);
});

test('noncanonical source IDs retain strict equality, including NaN', () => {
	const project = Object.freeze({ sources: Object.freeze([Object.freeze({ id: Number.NaN })]) });
	assert.equal(createVideoPreviewSourceMembership(project)(Number.NaN), false);
});

test('audio-only previews do not prepare unused source membership', () => {
	let probes = 0;
	const source = new Proxy(Object.freeze({ id: 'audio' }), {
		getOwnPropertyDescriptor(target, key) { probes++; return Reflect.getOwnPropertyDescriptor(target, key); },
	});
	const project = Object.freeze({ sources: Object.freeze([source]), clips: Object.freeze([
		Object.freeze({ kind: 'audio', id: 'audio-clip', sourceId: 'audio' }),
	]) });
	assert.equal(preview(project, () => null).clipStateById.size, 0);
	assert.equal(probes, 0);
});
