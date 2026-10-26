/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistanceEmbeddingMatrixV1, reviewAssistanceEmbeddingMatrixV1 } from '../src/common/editor/assistance/binary-formats-v1.ts';
import { createAssistanceSemanticIndexSearchProviderV1 } from '../src/common/editor/assistance/semantic-search-index-v1.ts';

test('owned Indexed Search avoids row copies, repeated OCR normalization and discarded single-provider fusion', async (context) => {
	const count = 12000, dimensions = 768, now = 1800000000000;
	const matrix = createAssistanceEmbeddingMatrixV1({ dimensions,
		vectors: Array.from({ length: count }, (_, index) => {
			const vector = new Float32Array(dimensions), angle = index / count * Math.PI;
			vector[0] = Math.cos(angle); vector[1] = Math.sin(angle); return vector;
		}) });
	const empty = createAssistanceEmbeddingMatrixV1({ dimensions: 1, vectors: [] });
	const rows = Array.from({ length: count }, (_, index) => ({ resultId: `visual:${index}`, timelineFrame: index * 24000, label: `Visual ${index}` }));
	const query = new Float32Array(dimensions); query[0] = 1;
	const make = (ocr: boolean) => createAssistanceSemanticIndexSearchProviderV1({ now: () => now,
		embedQuery: async () => query, index: { indexVersion: 1, schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project', projectRevision: 7, transcript: { matrix: empty, rows: [] },
			visual: { matrix, rows }, ocr: ocr ? rows.map((row) => ({ ...row, label: `Ａlpha beta indexed caption ${row.resultId}` })) : [] } });
	const single = make(false), mixed = make(true);
	let copies = 0, normalizations = 0, fusionComparisons = 0;
	const slice = Float32Array.prototype.slice, normalize = String.prototype.normalize, sort = Array.prototype.sort;
	context.mock.method(Float32Array.prototype, 'slice', function (this: Float32Array, start?: number, end?: number) {
		if (this.length === count * dimensions) copies += 1;
		return slice.call(this, start, end);
	});
	context.mock.method(String.prototype, 'normalize', function (this: string, form?: string) {
		if (String(this).includes('indexed caption')) normalizations += 1;
		return normalize.call(this, form);
	});
	Object.defineProperty(Array.prototype, 'sort', { configurable: true, writable: true,
		value: function (this: unknown[], compare?: (left: unknown, right: unknown) => number) {
			const fused = this.length === 10000 && this[0] && typeof this[0] === 'object' && 'providers' in this[0];
			return sort.call(this, fused && compare ? (left, right) => { fusionComparisons += 1; return compare(left, right); } : compare);
		} });
	context.after(() => Object.defineProperty(Array.prototype, 'sort', { configurable: true, writable: true, value: sort }));
	const request = { session: { sessionVersion: 1, sessionId: 'a'.repeat(40), schemaFamily: 'framescaper' as const,
		schemaVersion: 1 as const, projectId: 'project', projectRevision: 7, expiresAtEpochMs: now + 60000 },
		query: 'alpha beta', maximumResults: 50, signal: new AbortController().signal };
	const results = await single.search(request);
	assert.deepEqual(results, rows.slice(0, 50).map((row) => ({ ...row, detail: null, providers: ['visual'] })));
	assert.equal(fusionComparisons, 0);
	const first = await mixed.search(request), second = await mixed.search(request);
	assert.deepEqual(first, second);
	assert.equal(copies, 0);
	assert.equal(normalizations, 0);
	const reviewed = reviewAssistanceEmbeddingMatrixV1(matrix);
	const detached = reviewed.vector(0); detached.fill(0);
	assert.equal(reviewed.vector(0)[0], 1);
});
