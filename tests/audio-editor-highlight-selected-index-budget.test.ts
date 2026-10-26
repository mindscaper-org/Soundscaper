/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createAssistanceEmbeddingMatrixV1, reviewAssistanceEmbeddingMatrixV1 } from '../src/common/editor/assistance/binary-formats-v1.ts';
import { ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE, createAssistanceSemanticDerivativeBundleV1 } from '../src/common/editor/assistance/semantic-derivative-bundle-v1.ts';
import { prepareLocalAssistanceGuidedHighlightVisualEvidenceV1 } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-highlight-visual-evidence.ts';
import type { LocalAssistanceGuidedHighlightVideoSignalsV1 } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-highlight-signals.ts';

const vector = new Float32Array(768); vector[0] = 1;
const matrix = createAssistanceEmbeddingMatrixV1({ dimensions: 768, vectors: Array.from({ length: 13_200 }, () => vector) });
const bytes = createAssistanceSemanticDerivativeBundleV1({
	provider: 'visual', schemaFamily: 'framescaper', schemaVersion: 1,
	projectId: 'project', projectRevision: 7, sequenceId: 'sequence', sourceId: 'video-source', matrix,
	rows: Array.from({ length: 13_200 }, (_, index) => ({ resultId: `visual-${String(index)}`, timelineFrame: index * 24_000, label: 'Visual sample' })), ocr: [],
});
const record = { recordVersion: 1, derivativeVersion: 1, schemaFamily: 'framescaper', schemaVersion: 1,
	kind: 'visual-index', projectId: 'project', mediaType: ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE,
	payloadByteLength: bytes.byteLength, payloadSha256: bytesToHex(sha256(bytes)), bytes };
const fence = { schemaFamily: 'framescaper' as const, schemaVersion: 1 as const, projectId: 'project', revision: 7,
	sequenceId: 'sequence', sourceId: 'video-source', sourceSha256: '12'.repeat(32),
	sourceStartFrame: 0, sourceEndFrame: 198_000, timingAuthoritySha256: '34'.repeat(32), occurrenceIds: ['video-clip'] };
function video(windows: LocalAssistanceGuidedHighlightVideoSignalsV1['windows']): LocalAssistanceGuidedHighlightVideoSignalsV1 {
	return { schemaVersion: 1, kind: 'highlight-video-signals', sourceId: 'video-source', sampleRate: 48_000,
		timescale: 3_000, sourceSize: { width: 128, height: 72 }, videoOccurrenceId: 'video-clip', audioOccurrenceId: null,
		selectionStartFrame: 48_000, selectionEndFrame: 1_488_000, sourceTimeAuthority: [], reframeEvidence: null, windows };
}

test('a short highlight selection uses its matching rows from a full-source visual index', () => {
	const result = prepareLocalAssistanceGuidedHighlightVisualEvidenceV1({ video: video([
		{ id: 'first', startFrame: 48_000, endFrame: 768_000, shotStructure: 0, visualInterest: 0 },
		{ id: 'second', startFrame: 768_000, endFrame: 1_488_000, shotStructure: 0, visualInterest: 0 },
	]), fence, records: [record], signal: new AbortController().signal });
	assert.ok(result);
	assert.deepEqual(result.video.windows.map(({ visualInterest }) => visualInterest), [0, 0]);
	const reviewed = reviewAssistanceEmbeddingMatrixV1(result.embeddings);
	assert.equal(reviewed.rowCount, 2);
	assert.deepEqual(reviewed.vector(0), vector); assert.deepEqual(reviewed.vector(1), vector);
});

test('optional visual evidence above the selected work budget yields to the core highlight workflow', () => {
	assert.equal(prepareLocalAssistanceGuidedHighlightVisualEvidenceV1({ video: video([
		{ id: 'whole-source', startFrame: 0, endFrame: 400_000_000, shotStructure: 0, visualInterest: 0 },
	]), fence, records: [record], signal: new AbortController().signal }), null);
});
