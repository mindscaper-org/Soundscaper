/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

// Lightscaper imports DesignSystemRuntime before its optional Import dialog.
// A tiny unowned context can follow PrivacyPolicyRoute by reachability and
// make that route call the still-uninitialized DesignSystemRuntime initializer.
const context = 'vendor/audacity-design-system/components/src/TimeCode/time-code-musical-context.ts';

test('Lightscaper dialog theme uses the neutral vendor time-code context without a lazy privacy-route back-edge', () => {
	for (const path of [context, `/checkout/${context}`, context.replaceAll('/', '\\')]) {
		assert.equal(chunkGroupForModulePath(path), 'vendor-design-system', path);
	}
	for (const path of [context + '.foreign', context.replace('-context.ts', '-future-context.ts')]) {
		assert.notEqual(chunkGroupForModulePath(path), 'vendor-design-system', path);
	}
});
