/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reopen current-revision semantic bundles as authenticated menu-search custody. */

import { compareCodeUnits } from '../../code-unit-order.ts';
import { mergeSemanticSourceIndexes } from './internal/local-assistance-semantic-index-merge.ts';
import {
	ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE,
	reviewAssistanceSemanticDerivativeBundleV1,
	type ReviewedAssistanceSemanticDerivativeBundleV1,
} from '../../assistance/semantic-derivative-bundle-v1.ts';
import type {
	AssistanceAuthenticatedSemanticIndexCustodyPortV1,
	AssistanceSemanticSearchProjectAuthorityV1,
} from '../../assistance/semantic-search-runtime-v1.ts';
import type {
	AssistanceDerivativeRecordV1,
} from '../../storage/assistance-derivative-repository.ts';
import type {
	AssistanceDerivativeRepositoryPort,
} from '../../storage/deferred-assistance-derivative-repository.ts';
import {
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../../project-schema-identity.ts';

const PROJECT_ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const KINDS = Object.freeze(['embeddings', 'visual-index'] as const);

interface Candidate {
	readonly record: AssistanceDerivativeRecordV1;
	readonly bundle: ReviewedAssistanceSemanticDerivativeBundleV1;
}

export function createLocalAssistanceSemanticIndexCustodyV1(
	repository: Pick<AssistanceDerivativeRepositoryPort, 'listProject'>,
): AssistanceAuthenticatedSemanticIndexCustodyPortV1 {
	if (!repository || typeof repository.listProject !== 'function') {
		throw new TypeError('Semantic-index custody requires the disposable derivative repository.');
	}
	return Object.freeze({ async loadAuthenticated(
		authorityValue: AssistanceSemanticSearchProjectAuthorityV1,
		signal: AbortSignal,
	) {
		const authority = projectAuthority(authorityValue);
		if (!signal || typeof signal.throwIfAborted !== 'function') {
			throw new TypeError('Semantic-index custody requires cancellation authority.');
		}
		signal.throwIfAborted();
		const records = await repository.listProject(authority.projectId, KINDS);
		signal.throwIfAborted();
		const candidates = records.flatMap((record) => candidate(record, authority));
		if (candidates.length === 0) return null;
		candidates.sort(newestFirst);
		const sequenceId = candidates[0]!.bundle.sequenceId;
		const sequence = candidates.filter(({ bundle }) => bundle.sequenceId === sequenceId);
		const latest = new Map<string, Candidate>();
		for (const entry of sequence) {
			const key = `${entry.bundle.provider}:${entry.bundle.sourceId}`;
			if (!latest.has(key)) latest.set(key, entry);
		}
		const selected = [...latest.values()];
		selected.sort((left, right) => KINDS.indexOf(left.record.kind as typeof KINDS[number])
			- KINDS.indexOf(right.record.kind as typeof KINDS[number])
			|| compareCodeUnits(left.record.identitySha256, right.record.identitySha256));
		const transcript = mergeSemanticSourceIndexes(selected.filter(({ bundle }) => bundle.provider === 'transcript').map(({ bundle }) => bundle));
		const visual = mergeSemanticSourceIndexes(selected.filter(({ bundle }) => bundle.provider === 'visual').map(({ bundle }) => bundle));
		return Object.freeze({
			custodyVersion: 1 as const,
			disposition: 'authenticated-disposable' as const,
			schemaFamily: authority.schemaFamily,
			schemaVersion: authority.schemaVersion,
			projectId: authority.projectId,
			projectRevision: authority.projectRevision,
			records: Object.freeze(selected.map(({ record }) => Object.freeze({
				kind: record.kind, identitySha256: record.identitySha256,
				payloadSha256: record.payloadSha256,
			}))),
			index: Object.freeze({
				indexVersion: 1 as const,
				schemaFamily: authority.schemaFamily,
				schemaVersion: authority.schemaVersion,
				projectId: authority.projectId,
				projectRevision: authority.projectRevision,
				transcript: Object.freeze({ matrix: transcript.matrix, rows: transcript.rows }),
				visual: Object.freeze({ matrix: visual.matrix, rows: visual.rows }),
				ocr: visual.ocr,
			}),
		});
	} });
}

function candidate(
	record: AssistanceDerivativeRecordV1,
	authority: AssistanceSemanticSearchProjectAuthorityV1,
): readonly Candidate[] {
	try {
		if (record.schemaFamily !== authority.schemaFamily
			|| record.schemaVersion !== authority.schemaVersion
			|| record.mediaType !== ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE) return [];
		const bundle = reviewAssistanceSemanticDerivativeBundleV1(record.bytes);
		if (bundle.schemaFamily !== authority.schemaFamily
			|| bundle.schemaVersion !== authority.schemaVersion
			|| bundle.projectId !== authority.projectId
			|| bundle.projectRevision !== authority.projectRevision
			|| record.kind === 'embeddings' && bundle.provider !== 'transcript'
			|| record.kind === 'visual-index' && bundle.provider !== 'visual') return [];
		return [Object.freeze({ record, bundle })];
	} catch {
		return [];
	}
}

function newestFirst(left: Candidate, right: Candidate): number {
	return Date.parse(right.record.committedAt) - Date.parse(left.record.committedAt)
		|| compareCodeUnits(right.record.identitySha256, left.record.identitySha256);
}

function projectAuthority(value: unknown): AssistanceSemanticSearchProjectAuthorityV1 {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError('Semantic-index custody requires a current project schema.');
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== 4
		|| !Object.hasOwn(value, 'schemaFamily') || !Object.hasOwn(value, 'schemaVersion')
		|| !Object.hasOwn(value, 'projectId') || !Object.hasOwn(value, 'projectRevision')) {
		throw new TypeError('Semantic-index project authority is invalid.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	if (typeof row.projectId !== 'string' || !PROJECT_ID.test(row.projectId)
		|| !Number.isSafeInteger(row.projectRevision) || Number(row.projectRevision) < 0) {
		throw new TypeError('Semantic-index project authority is invalid.');
	}
	return Object.freeze({ schemaFamily: identity.schemaFamily, schemaVersion: PROJECT_SCHEMA_VERSION,
		projectId: row.projectId, projectRevision: Number(row.projectRevision) });
}
