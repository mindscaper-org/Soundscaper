/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalJsonRootSha256, canonicalJsonSha256 } from '../canonical-json-sha256.ts';
import { readCrossProductHandoffProvenance } from
	'../transfer/cross-product-handoff-provenance.ts';

/** A library change between inspection and activation must return to the decision flow. */
export class ScapeProjectReopenConflictError extends Error {
	readonly code = 'PROJECT_CHANGED';
	constructor() {
		super('The working project changed while reopening its saved file.');
		this.name = 'ScapeProjectReopenConflictError';
	}
}

/** Recheck after pending edits have been flushed; reuse never publishes archive state. */
export function reuseUnchangedScapeProject<Project>(archived: Project, existing: Project | null | undefined): Project {
	if (existing === null || existing === undefined || canonicalJsonSha256(archived) !== canonicalJsonSha256(existing)) {
		throw new ScapeProjectReopenConflictError();
	}
	return existing;
}

/** Exact evidence for unchanged reopens and sidecar-bound transfer admission. */
export function inspectScapeCanonicalEvidence(
	project: unknown | null,
	existing: unknown | null,
	includeTransferEvidence = true,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		projectCanonicalSha256: project === null ? null : canonicalJsonSha256(project),
		existingProjectCanonicalSha256: existing === null ? null : canonicalJsonSha256(existing),
		projectCanonicalRootSha256: !includeTransferEvidence || project === null ? null : canonicalJsonRootSha256(project),
		projectCrossProductHandoffProvenance: !includeTransferEvidence || project === null
			? null : readCrossProductHandoffProvenance(project),
		existingProjectCrossProductHandoffProvenance: !includeTransferEvidence || existing === null
			? null : readCrossProductHandoffProvenance(existing),
	});
}
