/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { effectMacroStepTypes } from '../src/common/editor/effect-macro-steps.ts';
import { audioEffectTypes } from '../src/common/editor/effects.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { resolveSupportedEffectType, safeEffectLabel } from '../src/common/editor/ui/inspector/effect-helpers.ts';

test('every offered replacement resolves back to a real effect type', () => {
	const registries: ReadonlyArray<readonly [string, readonly string[]]> = [
		['rack', audioEffectTypes() as readonly string[]],
		['macro', effectMacroStepTypes()],
	];

	for (const [name, types] of registries) {
		// A duplicate label would resolve to whichever effect is listed first,
		// silently swapping the step for a different effect.
		const labels = types.map((type) => safeEffectLabel(type, ENGLISH_COPY));
		assert.equal(new Set(labels).size, labels.length, `${name} labels must be unique`);
		for (const type of types) {
			assert.equal(
				resolveSupportedEffectType(safeEffectLabel(type, ENGLISH_COPY), 'en', ENGLISH_COPY, types),
				type,
				`the label the menu shows for ${type} must map back to it when picked`,
			);
		}
	}
});
