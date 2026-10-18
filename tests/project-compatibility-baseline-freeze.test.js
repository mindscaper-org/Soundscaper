/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryUrl = new URL('../', import.meta.url);
const IMPLEMENTATION_COMMIT = '573579b65852148d121e8f73046c57700ac93757';
const IMPLEMENTATION_TIMESTAMP = '2026-08-28T18:34:28+02:00';

async function json(path) {
	return JSON.parse(await readFile(new URL(path, repositoryUrl), 'utf8'));
}

async function text(path) {
	return readFile(new URL(path, repositoryUrl), 'utf8');
}

test('WP-9.0.0 records the family-v1 migration floor and implementation provenance', async () => {
	const compatibility = await json('config/project-compatibility.json');
	const decision = compatibility.baselineDecision;

	assert.deepEqual(
		compatibility.projectSchema.baselines.map(({ minimumReadableVersion, futureMigrationFloorVersion }) => ({
			minimumReadableVersion, futureMigrationFloorVersion,
		})),
		[
			{ minimumReadableVersion: 1, futureMigrationFloorVersion: 1 },
			{ minimumReadableVersion: 1, futureMigrationFloorVersion: 1 },
		],
	);
	assert.equal(
		compatibility.projectSchema.futureMigrationPolicy,
		'every-supported-successor-must-migrate-from-family-v1',
	);
	assert.deepEqual(compatibility.historicalPreReleaseLineage.retainedMigrationSources, []);
	assert.equal(decision.workPackage, 'WP-9.0.0');
	assert.equal(decision.commit, IMPLEMENTATION_COMMIT);
	assert.equal(decision.commitTimestamp, IMPLEMENTATION_TIMESTAMP);
});

test('capability and security registers carry the same RC identities without admission state', async () => {
	const capabilities = await json('config/production-capabilities.json');
	const security = await json('config/production-security-matrix.json');
	const expected = [
		{ schemaFamily: 'soundscaper', schemaVersion: 1 },
		{ schemaFamily: 'framescaper', schemaVersion: 1 },
	];

	assert.deepEqual(
		capabilities.projectSchemaBaselines.map(({ schemaFamily, schemaVersion }) => ({
			schemaFamily, schemaVersion,
		})),
		expected,
	);
	for (const baseline of capabilities.projectSchemaBaselines) {
		assert.deepEqual(baseline.scapeFormatVersions, [1]);
		assert.equal(baseline.attachedScapeFormatVersion, 1);
	}
	assert.deepEqual(security.projectIdentityBaseline.identities, expected);
	assert.equal(security.projectIdentityBaseline.archiveFormatVersion, 1);
	for (const register of [capabilities, security]) {
		assert.equal(register.releaseLineAuthority, 'config/product-release-lines.json');
		assert.equal(Object.hasOwn(register, 'productVersions'), false);
	}
});

test('the decision and release guidance retain implementation provenance and the preparation command', async () => {
	const [decision, release] = await Promise.all([
		text('docs/decisions/project-family-v1.md'),
		text('docs/operations/release.md'),
	]);

	assert.match(decision, /Leo Wattenberg/u);
	assert.ok(decision.includes(IMPLEMENTATION_COMMIT));
	assert.ok(decision.includes(IMPLEMENTATION_TIMESTAMP));
	assert.match(decision, /historical/iu);
	assert.match(release, /release:soundscaper:prepare/iu);
});
