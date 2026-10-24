/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTakeCompClipboardTrackOwnership } from '../src/common/editor/commands/take-comp-clipboard.ts';
import { visits, takeGroup } from './helpers/runtime50-editing-metrics.ts';

test('E04 take clipboard ownership visits each source track once across many take groups', context => {
	let reads = 0;
	const tracks = Array.from({ length: 100 }, (_, index) => ({ get sourceTrackId() { reads += 1; return `track-${index}`; }, sourceTrackType: 'audio', sourceSequenceId: 'sequence' }));
	const groups = Array.from({ length: 100 }, (_, index) => ({ ...takeGroup(), key: `group-${index}`, sourceTrackId: `track-${index}` }));
	assertTakeCompClipboardTrackOwnership(groups, tracks);
	assert.ok(reads <= 200, `ownership reads ${reads}`);
	context.diagnostic(`E04 ownership source reads: ${reads}`);
	assert.throws(() => assertTakeCompClipboardTrackOwnership([groups[0]!], [tracks[0], tracks[0]]), /missing source track/);
	assert.throws(() => assertTakeCompClipboardTrackOwnership([groups[0]!], [{ sourceTrackId: 'track-0', sourceTrackType: 'video', sourceSequenceId: 'sequence' }]), /audio-track sequence/);
});
