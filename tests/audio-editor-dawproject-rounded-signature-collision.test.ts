/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

test('DAWproject signature changes converging on one bar retain the final declared meter', () => {
	const document = parseDawprojectDocument(`<Project version="1.0"><Application name="Fixture" version="1"/><Transport><Tempo value="120" unit="bpm"/>
		<TimeSignature id="meter" numerator="4" denominator="4"/></Transport><Structure><Track id="track" contentType="audio"/></Structure>
		<Arrangement><TimeSignatureAutomation timeUnit="beats"><Target parameter="meter"/><TimeSignaturePoint time="3.5" numerator="3" denominator="4"/>
		<TimeSignaturePoint time="4" numerator="5" denominator="4"/></TimeSignatureAutomation></Arrangement></Project>`);
	let nextId = 0;
	const plan = buildDawprojectProject(document, { media: new Map(), createStableId: prefix => `${prefix}-${++nextId}` });
	const project = createCurrentAudioEditorProject(plan.project);
	assert.ok(Array.isArray(project.signatureMap.events));
	const signatures = project.signatureMap.events.map((event: unknown) => {
		assert.ok(event && typeof event === 'object' && 'bar' in event && 'numerator' in event && 'denominator' in event);
		return [event.bar, event.numerator, event.denominator];
	});
	assert.deepEqual(signatures, [[0, 4, 4], [1, 5, 4]]);
	assert.ok(plan.report.items.some(item => item.code === 'dawproject.signature-points-converted'));
});
