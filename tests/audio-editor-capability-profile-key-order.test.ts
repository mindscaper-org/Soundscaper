/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorProjectFeatureCapabilityProfile } from '../src/common/editor/project-feature-capability-profile.ts';

const CODE_UNIT_ORDERED_KEYS = ['audioX', 'audiob'] as const;

function registration(key: string, index: number) {
	return { key, featureId: `example.key${String(index)}`, available: true };
}

test('the profile builder requires registration keys in code-unit order', () => {
	const codeUnitOrdered = CODE_UNIT_ORDERED_KEYS.map(registration);
	assert.throws(
		() => createEditorProjectFeatureCapabilityProfile({ owner: 'example', registrations: [...codeUnitOrdered].reverse() }),
		/sorted and unique/u,
	);

	assert.doesNotThrow(
		() => createEditorProjectFeatureCapabilityProfile({ owner: 'example', registrations: codeUnitOrdered }),
	);
});
