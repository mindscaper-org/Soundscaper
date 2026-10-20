/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	framescaperProjectFeatureManifestContext,
	normalizeFramescaperProjectFeatureManifest,
} from '../src/framescaper/editor-project-feature-manifest-context.ts';

test('manifest normalization retains project context through the owner accessors', () => {
	const project: Record<string, unknown> = {
		featureRequirements: { schemaVersion: 2, requirements: [] },
		sources: [], clips: [], tracks: [], schemaVersion: 1,
		sampleRate: 48_000, sequences: [], primarySequenceId: null,
	};
	const accessors = {
		data: (value: Record<string, unknown>, key: string) => {
			return value[key];
		},
		records: (value: Record<string, unknown>, key: string) => {
			return value[key] as Record<string, unknown>[];
		},
	};
	assert.deepEqual(framescaperProjectFeatureManifestContext(project, accessors), {
		sources: [], clips: [], tracks: [], schemaVersion: 1,
		sampleRate: 48_000, sequences: [], primarySequenceId: null,
	});
	assert.deepEqual(normalizeFramescaperProjectFeatureManifest(project, accessors), {
		schemaVersion: 2, requirements: [],
	});
});

test('the shared context preserves each owner accessor error verbatim', () => {
	const expected = new TypeError('sources must be an own enumerable data property.');
	assert.throws(() => framescaperProjectFeatureManifestContext({}, {
		data: () => undefined,
		records: () => { throw expected; },
	}), (error) => error === expected);
});
