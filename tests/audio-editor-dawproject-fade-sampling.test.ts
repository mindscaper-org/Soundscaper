/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { envelopeValueAtFrame } from '../src/common/editor/automation.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { nestedDawprojectFadeFile } from './helpers/dawproject-nested-fade-fixture.ts';

for (const layers of [['in'], ['in', 'in'], ['in', 'in', 'out'], ['in', 'in', 'out', 'out']] as const) {
	test(`FileOpen retains the product of ${layers.join('/')} fades across the audible span`, async () => {
		let id = 0;
		const fixture = createFixture({ createStableId: prefix => `${prefix}-${++id}` });
		const result = await createNativeProjectService(fixture.runtime).openDawproject(await nestedDawprojectFadeFile(layers));
		assert.ok(result); assert.ok(validateAudioEditorProjectV17(result.project));
		const clip = result.project.clips[0]; assert.ok(clip); assert.equal(clip.durationFrames, 48_000);
		const envelope = clip.envelope ?? [];
		assert.ok(envelope.length <= 4096);
		for (let frame = 0; frame <= 48_000; frame += 125) {
			const time = 0.5 + frame / 48_000;
			const expected = layers.reduce((gain, layer) => gain * (layer === 'in' ? time / 1.5 : (3 - time) / 2.5), 1);
			const actual = Number(envelopeValueAtFrame(envelope, frame, 48_000));
			assert.ok(Math.abs(actual - expected) <= 0.00001, `${frame}: ${actual} differs from ${expected}`);
		}
	});
}
