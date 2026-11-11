/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePluginMidiEvents } from '../desktop/plugin-midi-events.ts';
test('native instrument wire rejects out-of-block messages and malformed MIDI bytes', () => {
	for (const events of [[{ frame: 4, data: [0x90, 60, 99] }], [{ frame: 0, data: [0x90, 128, 99] }],
		[{ frame: 0, data: [0xc0, 1, 0] }], [{ frame: 0, data: [0xf0, 1, 0] }],
		[{ frame: 2, data: [0xc0, 1] }, { frame: 1, data: [0xd0, 50] }]]) assert.throws(() => validatePluginMidiEvents(events, 4));
	assert.deepEqual(validatePluginMidiEvents([{ frame: 0, data: [0xc4, 12] }, { frame: 3, data: [0x94, 60, 99] }], 4),
		[{ frame: 0, data: [0xc4, 12] }, { frame: 3, data: [0x94, 60, 99] }]);
});
