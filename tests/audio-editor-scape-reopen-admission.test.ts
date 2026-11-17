/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createScapeOpenRequestService } from '../src/common/editor/controller/document/scape-open-request-service.ts';
import { hasMatchingScapeProjectDigests } from '../src/common/editor/scape-project-reopen.ts';
import { reuseUnchangedScapeProject, ScapeProjectReopenConflictError } from '../src/common/editor/scape-project-canonical-inspection.ts';

const digest = 'a'.repeat(64);
const unchanged = { exists: true, projectCanonicalSha256: digest, existingProjectCanonicalSha256: digest };

test('reuse requires complete matching canonical evidence and the current library document', () => {
	assert.equal(hasMatchingScapeProjectDigests(unchanged), true);
	for (const value of [null, undefined, '', 'invalid', 'A'.repeat(64)]) {
		assert.equal(hasMatchingScapeProjectDigests({ projectCanonicalSha256: value, existingProjectCanonicalSha256: value }), false);
	}
	assert.equal(hasMatchingScapeProjectDigests({ ...unchanged, existingProjectCanonicalSha256: 'b'.repeat(64) }), false);
	const existing = { id: 'lp', revision: 2, title: 'LP' };
	assert.equal(reuseUnchangedScapeProject({ ...existing }, existing), existing);
	assert.throws(() => reuseUnchangedScapeProject(existing, null), ScapeProjectReopenConflictError);
	assert.throws(() => reuseUnchangedScapeProject(existing, { ...existing, revision: 3 }), ScapeProjectReopenConflictError);
});

test('a failed reuse is reinspected once and requires a decision even if inspection still matches', async () => {
	let inspections = 0, opens = 0, decisions = 0;
	const service = createScapeOpenRequestService({ lifetime: new EditorControllerLifetime(),
		inspectScape: (_file, options) => { assert.equal(options.canonicalProjectDigest, 'reopen'); inspections++; return unchanged; },
		openScape: (_file, options) => { opens++; assert.equal(options.collision, 'reuse'); throw new ScapeProjectReopenConflictError(); },
	});
	assert.deepEqual(await service.openScapeFile(new Blob(), request => {
		decisions++; assert.equal(request.kind, 'collision'); return 'cancel';
	}), { cancelled: true });
	assert.deepEqual({ inspections, opens, decisions }, { inspections: 2, opens: 1, decisions: 1 });
});

for (const [kind, extra] of [
	['compatibility-collision', { featureRequirementsCompatibility: { compatible: false } }],
	['recovery', { recoveryChanges: [{ path: 'tracks', reason: 'Damage' }] }],
] as const) test(`matching documents still require the ${kind} decision`, async () => {
	const service = createScapeOpenRequestService({ lifetime: new EditorControllerLifetime(),
		inspectScape: () => ({ ...unchanged, ...extra }),
		openScape: () => assert.fail('Declined recovery or compatibility must not open.'),
	});
	assert.deepEqual(await service.openScapeFile(new Blob(), request => {
		assert.equal(request.kind, kind); return 'cancel';
	}), { cancelled: true });
});
