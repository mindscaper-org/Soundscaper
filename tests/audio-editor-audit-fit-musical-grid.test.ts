/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createTimelineGridLines, resolveTimelineRulerScale } from '../src/common/editor/ui/timeline/timeline-grid-model.ts';

test('fitting a long labeled project keeps beats and measures readable at supported minimum zoom', () => {
	const project = createSoundscaperProject({ id: 'long-label-project', timeDisplay: { format: 'beats+measures' },
		tracks: [{ id: 'labels', type: 'label', labels: [{ id: 'programme', startFrame: 0,
			endFrame: 10_800 * 48_000, title: 'Three hours' }] }] });
	assert.ok(validateSoundscaperProject(project));
	const scale = resolveTimelineRulerScale(project);
	assert.equal(scale.kind, 'beats-measures');
	for (const pixelsPerSecond of [1200 / 10_800, 0.001, 2.9]) for (const scrollX of [0, 817.25]) {
		const lines = createTimelineGridLines({ scale, pixelsPerSecond, scrollX, viewportWidth: 1200, sampleRate: 48_000 });
		assert.ok(lines.length > 1 && lines.length <= 21);
		assert.ok(lines.every(line => line.major));
		assert.ok(lines.every((line, index) => index === 0 || line.x - lines[index - 1]!.x >= 59));
	}
});
