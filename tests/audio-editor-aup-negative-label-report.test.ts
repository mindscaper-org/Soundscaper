/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAup3Fixture, createAup3ProjectData, serializeAup3Xml } from './aup3-fixture.js';
import { SQL } from './helpers/aup4-database-harness.js';
import { prepareAudacitySerializedDatabase, readAup4SampleBlock, upgradeAudacityProjectDatabase } from '../src/common/editor/aup4-database.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';

function itemsWithCode(items: readonly unknown[], code: string | null): Readonly<Record<string, unknown>>[] {
	return items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'
		&& !Array.isArray(item) && 'code' in item && item.code === code));
}

function labelCount(item: Readonly<Record<string, unknown>> | undefined): unknown {
	const data = item?.data;
	return data && typeof data === 'object' && 'labelCount' in data ? data.labelCount : undefined;
}

for (const geometry of [
	{ start: -2, end: -1, expected: 0, code: 'AUDACITY_LABELS_BEFORE_ZERO_OMITTED', disposition: 'omitted' },
	{ start: -1, end: 1, expected: 1, code: 'AUDACITY_LABELS_BEFORE_ZERO_TRIMMED', disposition: 'converted' },
	{ start: 0, end: 1, expected: 1, code: null, disposition: null },
] as const) test(`saved Audacity label ${geometry.start}..${geometry.end} reports its actual timeline conversion`, async () => {
	const bytes = await createAup3Fixture({ SQL, sampleRate: 8000 });
	const native = createAup3ProjectData({ sampleRate: 8000 }).project;
	const root = { ...native, children: [...native.children, { name: 'labeltrack', attributes: { name: 'Preroll', numlabels: 1 },
		children: [{ name: 'label', attributes: { t: geometry.start, t1: geometry.end, title: 'Original region' } }] }] };
	const xml = serializeAup3Xml(root);
	const database = new SQL.Database(prepareAudacitySerializedDatabase(bytes));
	try {
		database.run('UPDATE project SET dict=?,doc=? WHERE id=1', [xml.dictionary, xml.document]);
		const validation = upgradeAudacityProjectDatabase(database).validation;
		let ordinal = 0;
		const decoded = await decodeAudacityProjectTree(validation.document.root, (id: number) => readAup4SampleBlock(database, id), {
			sourceGeneration: 'aup3', idFactory: (prefix: string) => `${prefix}-${++ordinal}`,
		});
		assert.ok(validateAudioEditorProjectV17(decoded.project));
		assert.equal(decoded.project.clips.length, 1);
		assert.equal(decoded.project.timelineAnnotations.length, geometry.expected);
		const items: readonly unknown[] = decoded.compatibilityReport.items;
		const matching = itemsWithCode(items, geometry.code);
		assert.equal(matching.length, geometry.code ? 1 : 0);
		if (geometry.code) {
			assert.equal(matching[0]?.severity, 'warning');
			assert.equal(matching[0]?.disposition, geometry.disposition);
			assert.equal(labelCount(matching[0]), 1);
		}
		const converted = itemsWithCode(items, 'AUDACITY_LABEL_TRACK_CONVERTED_TO_TIMELINE_ANNOTATIONS');
		assert.equal(labelCount(converted[0]) ?? 0, geometry.expected, 'conversion accounting excludes labels that were omitted');
	} finally { database.close(); }
});
