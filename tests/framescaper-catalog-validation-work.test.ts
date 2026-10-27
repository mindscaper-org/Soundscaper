/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { generatorCatalog, proxyCatalog, profile } from './helpers/framescaper-catalog-work-fixtures.ts';

for (const kind of ['visual', 'proxy'] as const) {
	test(`actual Rename preserves complete ${kind} authority without per-occurrence catalog scans`, () => {
		const count = kind === 'visual' ? 500 : 300;
		const project = kind === 'visual' ? generatorCatalog(count) : proxyCatalog(count);
		const filter = Array.prototype.filter;
		let visits = 0;
		Array.prototype.filter = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T[] {
			const first = this[0] as { id?: unknown } | undefined;
			const measured = this.length === count && first?.id === (kind === 'visual' ? 'track-0' : 'video-0')
				&& new Error().stack?.includes(kind === 'visual' ? 'validateVisualModels' : 'validateAttachmentRelationships');
			if (!measured) return filter.call(this, predicate, receiver);
			return filter.call(this, (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); });
		};
		try {
			const result = applyFramescaperProjectCommand(profile, project, { type: 'project/rename', title: 'Renamed catalog' }, { now: '2026-10-26T00:00:00.000Z' });
			assert.equal(result.title, 'Renamed catalog');
			assert.deepEqual(result.clips, project.clips); assert.deepEqual(result.sources, project.sources);
			assert.ok(visits <= count * 50, `${visits} ${kind} full-catalog predicates`);
		} finally { Array.prototype.filter = filter; }
	});
}
