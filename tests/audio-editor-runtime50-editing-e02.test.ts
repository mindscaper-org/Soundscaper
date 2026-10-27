/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedLabelsForProject } from '../src/common/editor/label-clipboard-selection.ts';

test('E02 label selection does not materialize unrelated label catalogs', context => {
	let labelReads = 0;
	const unrelated = Array.from({ length: 200 }, (_, index) => ({ id: `other-${index}`, type: 'label', get labels() { labelReads += 1; return [{ id: 'other-label' }]; } }));
	const ref = { trackId: 'selected', labelId: 'valid' };
	const project = { id: 'project', tracks: [...unrelated, { id: 'selected', type: 'label', labels: [{ id: 'valid' }] }] };
	assert.deepEqual(selectedLabelsForProject(project, { selectedLabelsProjectId: 'project', selectedLabels: [ref, { trackId: 'selected', labelId: 'gone' }, ref] }), [ref, ref]);
	assert.equal(labelReads, 0);
	context.diagnostic(`E02 unrelated label catalog reads: ${labelReads}`);
	assert.deepEqual(selectedLabelsForProject(project, { selectedLabelsProjectId: 'other', selectedLabels: [ref] }), []);
});
