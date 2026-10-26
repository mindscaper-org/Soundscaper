/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';

export function masteringRegionProject() {
	return createSoundscaperProject({ id: 'mastering-region-sequences', primarySequenceId: 'main',
		sequences: [{ id: 'main', trackIds: [] }, { id: 'cut', trackIds: [] }],
		timelineAnnotations: [['main-region', 'main', 'Main region'], ['cut-a', 'cut', 'Cut opening'], ['cut-b', 'cut', 'Cut reprise']]
			.map(([id, sequenceId, name]) => ({ id, sequenceId, name, kind: 'region', anchor: 'sample',
				startFrame: 0, endFrame: 48_000, color: 'auto', batchId: null, opaqueExtensions: {} })),
		masteringSequences: [{ id: 'main-order', sequenceId: 'main', name: 'Main order', entries: [] },
			{ id: 'cut-order', sequenceId: 'cut', name: 'Cut order', entries: [{ id: 'opening', annotationId: 'cut-a' }] }],
	});
}
