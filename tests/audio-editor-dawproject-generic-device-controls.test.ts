/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { dawprojectGenericDeviceXml, indexedHighPassDevice } from './helpers/dawproject-generic-device-fixture.ts';

function imported(device: string, automation = '') {
	let serial = 0;
	const plan = buildDawprojectProject(parseDawprojectDocument(dawprojectGenericDeviceXml(device, automation)), {
		media: new Map([['voice.wav', { sampleRate: 48000, channelCount: 1, frameCount: 48000 }]]),
		createStableId: prefix => `${prefix}-${++serial}`,
	});
	return importSoundscaperAudacityProject(createCurrentAudioEditorProject(plan.project), plan.routingContext);
}

test('a DAWproject EQ band index does not bypass its high-pass filter or change its slope', () => {
	for (const index of [0, 1, 4]) {
		const project = imported(indexedHighPassDevice.replace('order="0"', `order="${index}"`));
		const track = project.tracks[0]; assert.ok(track?.type === 'audio');
		const effect = track.effects[0]; assert.ok(effect?.type === 'eq');
		assert.notEqual(effect.bypassed, true);
		const bands = effect.params.bands as readonly { slope: number }[];
		assert.equal(bands[0]!.slope, 12);
	}
});
