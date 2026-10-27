/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { audacityToggledTrackSelection } from '../src/common/editor/audacity-track-selection.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

test('E01 keyboard toggle checks selected membership without repeated full track scans', context => {
	const trackIds = Array.from({ length: 200 }, (_, index) => `track-${index}`);
	let result: readonly string[] = [];
	const count = visits('includes', () => { result = audacityToggledTrackSelection({ trackIds, focusedTrackId: trackIds[0]!, selectedTrackIds: trackIds }, 'toggle'); });
	assert.deepEqual(result, trackIds.slice(1));
	assert.ok(count <= 200, `membership work ${count}`);
	context.diagnostic(`E01 track membership slots: ${count}`);
	assert.ok(Object.isFrozen(result));
});
