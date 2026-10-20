/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	framescaperCapturedVideoProxyProjectFingerprint as fingerprint,
} from '../src/framescaper/editor-captured-video-proxy-preservation.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

type Data = Record<string, unknown>;

const SCHEMA_VERSION = 1;

function project(overrides: Data = {}): Data {
	return createFramescaperProject(PROFILE, overrides as never) as unknown as Data;
}

test('a captured proxy fingerprint is stable across repeated reads of one project', () => {
	const current = project();

	const first = fingerprint(SCHEMA_VERSION, PROFILE, current as never);
	const second = fingerprint(SCHEMA_VERSION, PROFILE, current as never);

	assert.equal(first, second);
	assert.match(first, /^[0-9a-f]+$/u);
});

test('a captured proxy fingerprint separates any two distinct projects', () => {
	const current = project();

	assert.notEqual(
		fingerprint(SCHEMA_VERSION, PROFILE, current as never),
		fingerprint(SCHEMA_VERSION, PROFILE, { ...current, title: 'Renamed' } as never),
	);
	assert.notEqual(
		fingerprint(SCHEMA_VERSION, PROFILE, project() as never),
		fingerprint(SCHEMA_VERSION, PROFILE, project() as never),
		'separately created projects carry their own identity',
	);
});
