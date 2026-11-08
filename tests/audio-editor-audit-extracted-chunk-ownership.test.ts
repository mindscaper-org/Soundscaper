/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('the extracted centroid stream retains its optional frequency analysis owner', () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/frequency-waveform-centroid-stream.ts'), 'editor-frequency-waveform');
});

test('shared component copy context retains the design-system foundation owner', () => {
	assert.equal(chunkGroupForModulePath('vendor/audacity-design-system/components/src/component-copy.ts'), 'vendor-design-system');
});

test('project filename identity retains the shared product profile owner', () => {
	assert.equal(chunkGroupForModulePath('src/common/project-file-extensions.ts'), 'product-profiles');
});

test('native project timing and render-plan construction retain their project foundation owner', () => {
	for (const name of ['editor-native-plan-timing-authority', 'editor-native-render-plan-authority',
		'editor-project-unified-render-professional', 'editor-project-unified-render-openfx', 'editor-project-unified-render-plan-native-media']) {
		assert.equal(chunkGroupForModulePath(`src/framescaper/${name}.ts`), 'framescaper-project-foundations');
	}
});
