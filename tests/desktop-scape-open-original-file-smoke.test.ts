/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopSmokeProbe } from '../desktop/desktop-smoke.js';
import {
	encodeScapeOpenSmokePlan,
	validateScapeOpenProjectDescriptor,
} from '../desktop/scape-open-smoke.js';

const PLAN = {
	schemaVersion: 1,
	mode: 'scape-range-open-v1',
	productId: 'soundscaper',
	token: '0123456789abcdef0123456789abcdef',
	archive: { name: 'project.sscape', byteLength: 90_000 },
	project: {
		id: 'project', title: 'Project', revision: 1,
		sourceId: 'source', trackId: 'track', clipId: 'clip',
	},
};
const READ = {
	id: 'a'.repeat(64),
	url: `soundscaper-app://bundle/_desktop/read/scape-range-v1/${'a'.repeat(64)}/project.sscape`,
	name: PLAN.archive.name,
	size: PLAN.archive.byteLength,
	mimeType: 'application/vnd.soundscaper.scape+zip',
	readProfile: 'scape-range-v1',
	lastModified: 1234,
};
const ORIGINAL = { id: 'b'.repeat(48), name: READ.name };

test('Scape-open smoke admits writable-file delivery against its original read-capability evidence', () => {
	const delivered = { ...READ, originalFile: ORIGINAL };
	const summary = validateScapeOpenProjectDescriptor(delivered, PLAN);
	assert.deepEqual(summary, validateScapeOpenProjectDescriptor(READ, PLAN));
	assert.doesNotMatch(JSON.stringify(summary), /originalFile|b{48}|a{64}/u);
	const probe = createDesktopSmokeProbe({
		argv: ['/opt/Soundscaper', '--soundscaper-smoke',
			`--soundscaper-smoke-mode=${PLAN.mode}`,
			`--soundscaper-smoke-plan=${encodeScapeOpenSmokePlan(PLAN)}`],
		appName: 'Soundscaper', appOrigin: 'soundscaper-app://bundle', productId: 'soundscaper',
		exit: async () => { assert.fail('Descriptor observation must not exit the application'); },
	});
	assert.equal(probe.observeProjectDescriptor(delivered, (id: string) => {
		assert.equal(id, READ.id);
		return READ;
	}), true);
});

test('Scape-open smoke rejects malformed original-file references and undeclared authority', () => {
	for (const originalFile of [
		null, {}, { ...ORIGINAL, id: '' }, { ...ORIGINAL, id: 'c'.repeat(64) },
		{ ...ORIGINAL, id: 'B'.repeat(48) }, { ...ORIGINAL, name: 'other.sscape' },
		{ ...ORIGINAL, path: '/private/project.sscape' },
	]) {
		assert.throws(() => validateScapeOpenProjectDescriptor({ ...READ, originalFile }, PLAN),
			/original.file|descriptor/iu);
	}
	assert.throws(() => validateScapeOpenProjectDescriptor({
		...READ, originalFile: ORIGINAL, path: '/private/project.sscape',
	}, PLAN), /descriptor/iu);
});
