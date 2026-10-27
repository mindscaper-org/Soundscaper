/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { TimelineAnnotationPanel } from '../src/common/editor/ui/timeline/TimelineAnnotationPanel.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { resolveRuntimeTimelineAnnotationsProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
test('typing one marker name leaves every other marker row untouched', async () => {
	const seed = createSoundscaperProject({ id: 'marker-name-work' });
	const project = createSoundscaperProject({ ...seed, timelineAnnotations: Array.from({ length: 100 }, (_, i) => ({ id: `marker-${i}`, sequenceId: seed.primarySequenceId, kind: 'marker', anchor: 'sample', name: `Cue ${i}`, positionFrame: i * 48000, color: 'auto', batchId: null, opaqueExtensions: {} })) });
	const reads = Array.from({ length: 100 }, () => 0);
	const annotations = resolveRuntimeTimelineAnnotationsProjection(project).map((annotation, i) => ({ ...annotation, get name() { reads[i] = (reads[i] ?? 0) + 1; return annotation.name; } }));
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const noop = () => undefined;
	try {
		await act(async () => root.render(<TimelineAnnotationPanel controller={{ actions: { timelineAnnotations: { focus: noop, rename: noop } } }} project={project} annotations={annotations} selectedAnnotationId="marker-0" copy={ENGLISH_COPY} locale="en" sampleRate={48000} blocked={false} run={(operation: () => unknown) => operation()} createAnnotation={noop} />));
		const input = dom.one('input');
		Object.assign(input, { select: noop });
		await act(async () => reactProps(input).onFocus?.());
		const initial = [...reads];
		for (const text of ['C', 'Cu', 'Cue', 'Cue ', 'Cue 1']) await act(async () => reactProps(input).onChange?.({ target: { value: text } }));
		assert.deepEqual(reads.slice(1), initial.slice(1));
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
