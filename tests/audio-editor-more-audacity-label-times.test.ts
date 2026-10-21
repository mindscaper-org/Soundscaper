/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacityXmlNode } from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { decodeLegacyAupProject } from '../src/common/editor/aup-legacy.js';
import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';

function ids() { let id = 0; return (prefix: string) => `${prefix}-${String(++id)}`; }

test('MP24: Audacity projects with labels before origin still open and retain the visible region', async () => {
	const root = createAudacityXmlNode('project', [], [createAudacityXmlNode('labeltrack', [], [
		createAudacityXmlNode('label', [
			{ kind: 'attribute', name: 't', type: 'double', value: -1 },
			{ kind: 'attribute', name: 't1', type: 'double', value: 1 },
			{ kind: 'attribute', name: 'title', type: 'string', value: 'Visible region' },
		]),
		createAudacityXmlNode('label', [
			{ kind: 'attribute', name: 't', type: 'double', value: -2 },
			{ kind: 'attribute', name: 't1', type: 'double', value: -1 },
			{ kind: 'attribute', name: 'title', type: 'string', value: 'Before origin' },
		]),
	])]);
	const decoded = await decodeAudacityProjectTree(root, async () => null, { idFactory: ids(), planAudio: true });
	assert.deepEqual(decoded.project.timelineAnnotations.map((label) => ({ name: label.name,
		start: label.kind === 'region' ? label.startFrame : label.positionFrame,
		end: label.kind === 'region' ? label.endFrame : label.positionFrame,
	})), [{ name: 'Visible region', start: 0, end: 44_100 }]);
});

test('MP24: legacy AUP labels wholly before origin do not become phantom zero markers', async () => {
	const structure = await decodeLegacyAupProject(new File([`<project rate="48000"><labeltrack>
		<label t="-1" t1="1" title="Visible region"/><label t="-2" t1="-1" title="Before origin"/>
		</labeltrack></project>`], 'labels.aup'), []);
	const result = convertLegacyAupToProject(structure, { idFactory: ids() });
	assert.deepEqual(result.project.timelineAnnotations.map(({ name }) => name), ['Visible region']);
});
