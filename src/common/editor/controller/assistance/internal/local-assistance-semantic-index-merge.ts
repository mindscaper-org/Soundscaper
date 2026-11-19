/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createAssistanceEmbeddingMatrixV1 } from '../../../assistance/binary-formats-v1.ts';
import type { AssistanceSemanticDerivativeRowV1, ReviewedAssistanceSemanticDerivativeBundleV1 } from '../../../assistance/semantic-derivative-bundle-v1.ts';

const MAXIMUM_ROWS = 100_000;
const MAXIMUM_MATRIX_BYTES = 512 * 1024 * 1024;
const encoder = new TextEncoder();

/** Combine source bundles without confusing provider-local row identities. */
export function mergeSemanticSourceIndexes(bundles: readonly ReviewedAssistanceSemanticDerivativeBundleV1[]) {
	const dimensions = bundles[0]?.matrix.dimensions ?? 1;
	const count = bundles.reduce((total, bundle) => total + bundle.rows.length, 0);
	if (count > MAXIMUM_ROWS || count * dimensions * 4 > MAXIMUM_MATRIX_BYTES - 256) {
		throw new RangeError('Combined semantic index exceeds its bounded row or matrix inventory.');
	}
	if (bundles.some(bundle => bundle.matrix.dimensions !== dimensions)) {
		throw new TypeError('Semantic source indexes use incompatible embedding dimensions.');
	}
	const vectors: Float32Array[] = [];
	const rows: AssistanceSemanticDerivativeRowV1[] = [];
	const ocr: AssistanceSemanticDerivativeRowV1[] = [];
	for (const bundle of bundles) {
		for (let index = 0; index < bundle.rows.length; index++) {
			vectors.push(bundle.matrix.vector(index));
			rows.push(scopedRow(bundle.sourceId, bundle.rows[index]!));
		}
		ocr.push(...bundle.ocr.map(row => scopedRow(bundle.sourceId, row)));
		if (ocr.length > MAXIMUM_ROWS) throw new RangeError('Combined OCR index exceeds its bounded row inventory.');
	}
	return Object.freeze({ matrix: createAssistanceEmbeddingMatrixV1({ dimensions, vectors }), rows: Object.freeze(rows), ocr: Object.freeze(ocr) });
}

function scopedRow(sourceId: string, row: AssistanceSemanticDerivativeRowV1): AssistanceSemanticDerivativeRowV1 {
	return Object.freeze({ ...row, resultId: `semantic:${bytesToHex(sha256(encoder.encode(JSON.stringify([sourceId, row.resultId]))))}` });
}
