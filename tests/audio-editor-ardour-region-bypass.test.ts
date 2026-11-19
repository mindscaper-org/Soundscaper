/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ardourSession } from './helpers/native-daw-import-fixtures.ts';

test('disabled Ardour region fades and envelopes remain bypassed after File Open', () => {
	for (const inactive of ['0', 'no', 'false']) {
		const xml = ardourSession().replace('muted="0"/>', `muted="0" fade-in-active="${inactive}" fade-out-active="${inactive}" envelope-active="${inactive}">
			<FadeIn><AutomationList><events>0 0\n240 1</events></AutomationList></FadeIn>
			<FadeOut><AutomationList><events>0 1\n480 0</events></AutomationList></FadeOut>
			<Envelope><AutomationList><events>0 .1\n24000 .1</events></AutomationList></Envelope></Region>`);
		let ordinal = 0;
		const plan = buildTimelineInterchangeProject(parseArdourDocument(xml), { createStableId: prefix => `${prefix}-${++ordinal}` });
		const clip = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer }).clips[0]!;
		assert.equal(clip.fadeInFrames, 0, `fade-in-active=${inactive}`);
		assert.equal(clip.fadeOutFrames, 0, `fade-out-active=${inactive}`);
		assert.deepEqual(clip.envelope, [], `envelope-active=${inactive}`);
	}
});
