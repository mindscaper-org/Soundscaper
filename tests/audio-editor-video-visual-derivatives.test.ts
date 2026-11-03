/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoVisualDerivativePublisher } from '../src/common/editor/controller/document/internal/video-visual-derivatives.ts';
import { videoVisualMediaIdentity } from '../src/common/editor/controller/document/internal/video-visual-media-sync.ts';
import type { ProjectVisualSource, VideoVisualRecord } from '../src/common/editor/controller/document/project-visual-types.ts';

function fixture() {
	const source: ProjectVisualSource = { id: 'video', kind: 'video', storageKey: 'video', contentSha256: 'a'.repeat(64) };
	const sources: ProjectVisualSource[] = [source];
	const records = new Map<string, Readonly<VideoVisualRecord>>([[source.id, {
		visual: Object.freeze({ mediaUrl: 'blob:original', posterUrl: null, thumbnails: [] }),
		objectUrls: ['blob:original'], linkedPlaybackLease: null,
	}]]);
	const revoked: string[] = [];
	let allocated = 0;
	const publish = createVideoVisualDerivativePublisher(() => sources, records,
		new Map([[source.id, videoVisualMediaIdentity(source)]]), {
			createObjectURL: () => `blob:preview-${++allocated}`,
			revokeObjectURL: url => { revoked.push(url); },
		});
	return { source, sources, records, revoked, publish, allocations: () => allocated };
}

test('incremental derivatives preserve the decoder URL and publish immutable sorted filmstrips', () => {
	const { source, records, publish } = fixture();
	const original = records.get(source.id)!;
	assert.equal(publish(source, { type: 'poster', blob: new Blob(['poster']) }), true);
	assert.equal(publish(source, { type: 'thumbnail', timestamp: 5, blob: new Blob(['five']) }), true);
	const first = records.get(source.id)!;
	assert.equal(publish(source, { type: 'thumbnail', timestamp: 0, blob: new Blob(['zero']) }), true);
	const current = records.get(source.id)!;
	assert.equal(current.visual.mediaUrl, 'blob:original');
	assert.equal(current.visual.posterUrl, 'blob:preview-1');
	assert.deepEqual(current.visual.thumbnails.map(frame => frame.timestampSeconds), [0, 5]);
	assert.equal(first.visual.thumbnails.length, 1);
	assert.equal(original.visual.thumbnails.length, 0);
	assert.equal(current.objectUrls.length, 4, 'All live URLs must remain owned for teardown.');
});

test('replaced previews release only their own URLs and preserve a borrowed poster', () => {
	const { source, records, publish, revoked } = fixture();
	publish(source, { type: 'thumbnail', timestamp: 0, blob: new Blob(['first']) });
	publish(source, { type: 'poster', blob: new Blob(['poster']) });
	assert.deepEqual(revoked, [], 'The thumbnail backing the first poster is still in use.');
	publish(source, { type: 'thumbnail', timestamp: 0, blob: new Blob(['replacement']) });
	assert.deepEqual(revoked, ['blob:preview-1']);
	assert.equal(records.get(source.id)?.visual.posterUrl, 'blob:preview-2');
	publish(source, { type: 'poster', blob: new Blob(['new poster']) });
	assert.deepEqual(revoked, ['blob:preview-1', 'blob:preview-2']);
	assert.deepEqual(records.get(source.id)?.objectUrls, ['blob:original', 'blob:preview-3', 'blob:preview-4']);
});

test('retired and replaced sources refuse late pixels without allocating URLs', () => {
	for (const change of ['remove', 'replace', 'revoke'] as const) {
		const { source, sources, records, publish, allocations } = fixture();
		if (change === 'remove') sources.length = 0;
		else if (change === 'replace') sources[0] = { ...source, contentSha256: 'b'.repeat(64) };
		else records.clear();
		assert.equal(publish(source, { type: 'thumbnail', blob: new Blob(['late']) }), false);
		assert.equal(allocations(), 0);
	}
});
