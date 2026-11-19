/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ardourSession } from './helpers/native-daw-import-fixtures.ts';

for (const connected of [false, true]) test(`Ardour explicit ${connected ? 'connected' : 'disconnected'} output retains its audible assignment`, () => {
	const io = `<IO direction="Output"><Port name="Dialogue/audio_out 1" type="audio">${connected ? '<Connection other="system:playback_1"/>' : ''}</Port></IO>`;
	const xml = ardourSession(true).replace('</Pannable>', `</Pannable>${io}`);
	let serial = 0;
	const plan = buildTimelineInterchangeProject(parseArdourDocument(xml), { createStableId: prefix => `${prefix}-${++serial}` });
	const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
	const assignment = project.mixer.edges.find(edge => edge.kind === 'assignment' && edge.source.kind === 'track');
	assert.equal(assignment?.level, connected ? 1 : 0, 'an unconnected strip must not acquire a new main output');
	assert.equal(project.clips.length, 1, 'disconnection keeps the editable material');
});
