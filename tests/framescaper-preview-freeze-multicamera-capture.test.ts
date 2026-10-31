/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { bindFramescaperPreviewFreezeCapture } from '../src/common/editor/ui/workspace/video-preview-freeze-capture.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { planFramescaperMulticameraCommandSequence } from '../src/framescaper/editor-project-sequence-multicam.ts';
import { framescaperSelectedFreezeCaptureFinishingFor } from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';

for (const mode of ['ordinary', 'initial', 'switched'] as const) {
	void test(`preview Freeze captures the ${mode} camera without changing the authored clip source`, async context => {
		const project = fixture(mode);
		const sourceId = mode === 'switched' ? 'camera-b' : 'camera-a';
		const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
		const priorImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
		Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
			width: 0, height: 0, getContext: () => ({ putImageData: () => undefined }),
			toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['png'], { type: 'image/png' })),
		}) } });
		Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
			constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
		} });
		context.after(() => {
			if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument); else Reflect.deleteProperty(globalThis, 'document');
			if (priorImageData) Object.defineProperty(globalThis, 'ImageData', priorImageData); else Reflect.deleteProperty(globalThis, 'ImageData');
		});
		const { capture, renders } = await boundCapture(project, cleanup => context.after(cleanup));
		const result = await capture.capture({ projectId: project.id, projectRevision: project.revision,
			timelineSample: 19_200, clipId: 'take', sourceId, sourceOrdinal: 10 });
		assert.equal(result.blob.type, 'image/png');
		assert.equal(renders(), 2, 'the programme readback restores the preview render');
		const clip = project.clips[0];
		assert.ok(clip && 'sourceId' in clip);
		assert.equal(clip.sourceId, 'camera-a', 'the canonical clip retains its authored source');
	});
}

for (const mismatch of ['old-camera', 'foreign-camera', 'revision', 'sample', 'sequence'] as const) {
	void test(`switched-camera Freeze refuses ${mismatch} before reading the compositor`, async context => {
		const project = fixture('switched');
		const { capture, renders } = await boundCapture(project, cleanup => context.after(cleanup), {
			sequenceId: mismatch === 'sequence' ? 'other-sequence' : 'main',
		});
		await assert.rejects(capture.capture({ projectId: project.id,
			projectRevision: project.revision + (mismatch === 'revision' ? 1 : 0),
			timelineSample: mismatch === 'sample' ? 19_201 : 19_200, clipId: 'take',
			sourceId: mismatch === 'old-camera' ? 'camera-a' : mismatch === 'foreign-camera' ? 'foreign-camera' : 'camera-b',
			sourceOrdinal: 10 }), /preview is stale/u);
		assert.equal(renders(), 0);
	});
}

for (const change of ['camera', 'revision'] as const) {
	void test(`Freeze rejects a ${change} change during compositor rendering`, async context => {
		const project = fixture('switched');
		const { capture, renders } = await boundCapture(project, cleanup => context.after(cleanup), {
			duringRender(current) {
				if (change === 'revision') return { ...current, revision: current.revision + 1 };
				const plan = planFramescaperMulticameraCommandSequence(PROFILE, current, current.multicameraGroups, {
					type: 'multicamera/switch', projectId: current.id, expectedProjectRevision: current.revision,
					groupId: 'group', expectedActiveMemberId: 'b', memberId: 'a',
				});
				// Isolate the source fence even if an otherwise unchanged revision accompanies the camera change.
				return { ...current, multicameraGroups: plan.after };
			},
		});
		await assert.rejects(capture.capture({ projectId: project.id, projectRevision: project.revision,
			timelineSample: 19_200, clipId: 'take', sourceId: 'camera-b', sourceOrdinal: 10 }), /preview is stale/u);
		assert.equal(renders(), 2, 'the preview quality is restored before the changed capture is refused');
	});
}

void test('Freeze refuses a missing active camera member before compositor rendering', async context => {
	const project = fixture('switched');
	assert.ok(Array.isArray(project.multicameraGroups));
	const group = project.multicameraGroups[0];
	assert.ok(group && typeof group === 'object' && !Array.isArray(group));
	const { capture, renders } = await boundCapture({ ...project,
		multicameraGroups: [{ ...group, activeMemberId: 'missing-camera' }],
	}, cleanup => context.after(cleanup));
	await assert.rejects(capture.capture({ projectId: project.id, projectRevision: project.revision,
		timelineSample: 19_200, clipId: 'take', sourceId: 'camera-b', sourceOrdinal: 10 }), /active member/u);
	assert.equal(renders(), 0);
});

async function boundCapture(project: ReturnType<typeof fixture>, after: (cleanup: () => void) => void,
	options: Readonly<{ sequenceId?: string; duringRender?: (current: ReturnType<typeof fixture>) => ReturnType<typeof fixture> }> = {}) {
	const owner = {};
	let renders = 0;
	const projectRef = { current: project };
	const release = await bindFramescaperPreviewFreezeCapture({ owner, projectRef,
		evaluatedRef: { current: { projectId: project.id, projectRevision: project.revision,
			sequenceId: options.sequenceId ?? 'main', timelineSample: 19_200 } },
		compositorRef: { current: {
			render() {
				renders += 1;
				if (renders === 1 && options.duringRender) projectRef.current = options.duringRender(projectRef.current);
				return { status: 'ready' };
			},
			captureEvaluatedRgba() { return { width: 1, height: 1, rgba: new Uint8Array(4) }; },
		} }, layersRef: { current: [] }, renderOptionsRef: { current: { referenceWidth: 1, referenceHeight: 1 } } });
	after(release);
	const capture = framescaperSelectedFreezeCaptureFinishingFor(owner);
	assert.ok(capture);
	return { capture, renders: () => renders };
}

function fixture(mode: 'ordinary' | 'initial' | 'switched') {
	const project = createFramescaperProject(PROFILE, {
		id: 'programme', title: 'Programme', now: '2026-10-31T12:00:00.000Z',
		sources: ['camera-a', 'camera-b'].map((id, index) => createVideoSource({ id, name: `${id}.mp4`,
			storageKey: id, mimeType: 'video/mp4', contentSha256: (index ? '34' : '12').repeat(32),
			sampleFrameCount: 48_000, sourceFrameCount: 25, frameRate: { num: 25, den: 1 }, width: 320, height: 180 })),
		clips: [{ kind: 'video', id: 'take', sourceId: 'camera-a', sequenceId: 'main', title: 'Programme',
			sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25 }],
		tracks: [{ type: 'video', id: 'picture', name: 'Picture', clipIds: ['take'] }],
		sequences: [{ id: 'main', name: 'Main', rate: { num: 25, den: 1 }, trackIds: ['picture'] }],
		primarySequenceId: 'main',
		...(mode === 'ordinary' ? {} : { multicameraGroups: [{ id: 'group', projectId: 'programme',
			sequenceId: 'main', outputClipId: 'take', activeMemberId: 'a', members: [
				{ id: 'a', groupId: 'group', sourceId: 'camera-a', syncOffsetSamples: 0 },
				{ id: 'b', groupId: 'group', sourceId: 'camera-b', syncOffsetSamples: 0 },
			] }] }),
	});
	if (mode !== 'switched') return project;
	const plan = planFramescaperMulticameraCommandSequence(PROFILE, project, project.multicameraGroups, {
		type: 'multicamera/switch', projectId: project.id, expectedProjectRevision: project.revision,
		groupId: 'group', expectedActiveMemberId: 'a', memberId: 'b',
	});
	return { ...project, revision: project.revision + 1, multicameraGroups: plan.after };
}
