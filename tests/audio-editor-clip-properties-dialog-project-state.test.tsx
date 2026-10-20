/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { deferred } from './helpers/async-test-control.ts';
import {
	installReactTestDom, reactProps,
} from './helpers/react-test-dom.ts';

test('clip property async failures belong only to the project and clip that started them', async () => {
	const fixture = await mountedClipPropertiesFixture();
	try {
		await fixture.render(project('project-a'));
		await fixture.startNormalizePeak();
		assert.deepEqual(fixture.normalizeCalls.map(({ projectId, clipId }) => ({ projectId, clipId })), [
			{ projectId: 'project-a', clipId: 'shared-clip' },
		]);

		await fixture.render(project('project-b'));
		await reject(fixture.normalizeCalls[0]!.completion, new Error('Project A normalization failed'));
		assert.deepEqual(fixture.failures, [], 'a stale project failure must not reach the workspace runner');

		await fixture.startNormalizePeak();
		await reject(fixture.normalizeCalls[1]!.completion, new Error('Project B normalization failed'));
		assert.equal(fixture.failures[0]?.message, 'Project B normalization failed');
	} finally {
		await fixture.cleanup();
	}
});

async function mountedClipPropertiesFixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let currentProject = project('initial');
	const normalizeCalls: Array<Readonly<{
		projectId: string;
		clipId: string;
		completion: Deferred<void>;
	}>> = [];
	const failures: Error[] = [];
	const run = (operation: () => unknown) => {
		const value = operation();
		void Promise.resolve(value).catch(cause => { failures.push(cause as Error); });
		return value;
	};
	const controller = {
		get project() { return currentProject; },
		actions: {
			clip: {
				update: () => undefined,
				move: () => undefined,
				trim: () => undefined,
				setTimePitch: () => undefined,
				toggleStretchToTempo: () => undefined,
				reverse: () => undefined,
				normalizePeak: (clipId: string) => {
					const completion = deferred<void>();
					normalizeCalls.push({ projectId: currentProject.id, clipId, completion });
					return completion.promise;
				},
				normalizeLoudness: () => undefined,
				renderPitchSpeed: () => undefined,
				resetPitchSpeed: () => undefined,
			},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		normalizeCalls,
		failures,
		render: async (nextProject: ReturnType<typeof project>) => {
			currentProject = nextProject;
			await act(async () => root.render(<ClipPropertiesPanel
				run={run}
				controller={controller}
				snapshot={{
					project: nextProject,
					selectedClipId: 'shared-clip',
					capabilities: { audioEffects: true, videoEffects: false },
				}}
				copy={ENGLISH_COPY}
			/>));
		},
		startNormalizePeak: async () => {
			const trigger = dom.one('[data-clip-audio-settings]');
			await act(async () => reactProps(trigger).onClick({ currentTarget: trigger }));
			const item = dom.container.querySelectorAll('[role="menuitem"]').find(node =>
				node.querySelector('.context-menu-item-label')?.textContent === ENGLISH_COPY.normalizePeak);
			assert.ok(item);
			await act(async () => reactProps(item).onClick({ stopPropagation() {} }));
		},
		cleanup: async () => {
			for (const call of normalizeCalls) call.completion.resolve();
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function project(id: string) {
	const source = createAudioSource({
		id: 'shared-source', storageKey: `${id}-source`, name: `${id} source`,
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'shared-clip', sourceId: source.id, title: `${id} clip`,
		timelineStartFrame: 0, durationFrames: 200,
		sourceStartFrame: 0, sourceDurationFrames: 200,
	});
	return createSoundscaperProject({
		id, title: id, now: '2026-08-29T00:00:00.000Z',
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'shared-track', name: 'Track', clipIds: [clip.id] })],
	});
}

async function reject(completion: Deferred<void>, error: Error): Promise<void> {
	await act(async () => {
		completion.reject(error);
		await completion.promise.catch(() => undefined);
		await Promise.resolve();
	});
}

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
	readonly reject: (cause: unknown) => void;
}
