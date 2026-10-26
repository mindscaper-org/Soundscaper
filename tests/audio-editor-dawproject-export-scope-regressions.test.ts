/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { walkXml } from '../src/common/editor/dawproject-xml.ts';

function project() {
	return {
		id: 'project', sampleRate: 48_000, primarySequenceId: 'first',
		tracks: [{ type: 'audio', id: 'voice', name: 'Voice', clipIds: [] },
			{ type: 'audio', id: 'private', name: 'Other sequence', clipIds: [] }],
		sequences: [{ id: 'first', trackNodes: [{ kind: 'track', id: 'voice', parentFolderId: null }] },
			{ id: 'second', trackNodes: [{ kind: 'track', id: 'private', parentFolderId: null }] }],
		timelineAnnotations: [{ id: 'a', sequenceId: 'first', kind: 'marker', anchor: 'sample', name: 'First cue', positionFrame: 48_000 },
			{ id: 'b', sequenceId: 'second', kind: 'marker', anchor: 'sample', name: 'Other cue', positionFrame: 96_000 }],
		sources: [], clips: [],
	};
}

test('DAWproject export includes only tracks assigned to the selected sequence', () => {
	const result = createDawprojectExport({ project: project(), sequenceId: 'first' });
	const names = [...walkXml(result.document)].filter(({ name }) => name === 'Track').map(({ attributes }) => attributes.name);
	assert.ok(names.includes('Voice'));
	assert.ok(!names.includes('Other sequence'));
});

test('DAWproject export excludes timeline markers belonging to other sequences', () => {
	const result = createDawprojectExport({ project: project(), sequenceId: 'second' });
	const names = [...walkXml(result.document)].filter(({ name }) => name === 'Marker').map(({ attributes }) => attributes.name);
	assert.deepEqual(names, ['Other cue']);
});

test('seconds-based time signatures resolve through the imported tempo map', () => {
	let id = 0;
	const document = parseDawprojectDocument(`<Project><Transport><Tempo unit="bpm" value="120"/></Transport>
		<Arrangement><TimeSignatureAutomation timeUnit="seconds"><TimeSignaturePoint time="4" numerator="3" denominator="4"/>
		</TimeSignatureAutomation></Arrangement></Project>`);
	const result = buildDawprojectProject(document, { media: new Map(), createStableId: (prefix) => `${prefix}-${String(++id)}` });
	const map = result.project.signatureMap as { events: { bar: number; numerator: number }[] };
	assert.deepEqual(map.events.map(({ bar, numerator }) => [bar, numerator]), [[0, 4], [2, 3]]);
});
