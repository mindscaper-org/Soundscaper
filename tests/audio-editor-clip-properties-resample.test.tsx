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
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('clip properties report the rate of the clip that is selected', async () => {
	const fixture = await mountedFixture();
	try {
		await fixture.render();
		assert.equal(reactProps(fixture.sourceRate()).value, '96000');
		assert.equal(fixture.project.sampleRate, 48_000);
		assert.equal(fixture.project.sources[0]?.sampleFormat, 'int24');
		assert.deepEqual(fixture.resampleCalls, []);
	} finally {
		await fixture.cleanup();
	}
});

test('a resampling rate draft applies to the selected clip alone', async () => {
	const fixture = await mountedFixture();
	try {
		await fixture.render();
		assert.equal(reactProps(fixture.sourceRate()).value, '96000');
		await fixture.editRate('48000');
		assert.deepEqual(fixture.resampleCalls, [], 'drafting never rewrites audio');
		await fixture.submitResample();
		assert.deepEqual(fixture.resampleCalls, [['shared-clip', { sampleRate: 48_000, sampleFormat: 'int24' }]]);
		assert.equal(fixture.project.sources[0]?.sampleFormat, 'int24', 'the imported format declaration remains intact');
	} finally {
		await fixture.cleanup();
	}
});

test('a product without audio effects reports the rate but cannot resample', async () => {
	const fixture = await mountedFixture({ audioEffects: false });
	try {
		await fixture.render();
		assert.equal(reactProps(fixture.sourceRate()).value, '96000');
		assert.equal(reactProps(fixture.sourceRate()).disabled, true);
		assert.equal(reactProps(fixture.resampleButton()).disabled, true);
		await fixture.submitResample();
		assert.deepEqual(fixture.resampleCalls, []);
	} finally {
		await fixture.cleanup();
	}
});

async function mountedFixture(capabilities: Readonly<Record<string, boolean>> = { audioEffects: true }) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const currentProject = project();
	const resampleCalls: Array<[string, unknown]> = [];
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
				normalizePeak: () => undefined,
				normalizeLoudness: () => undefined,
				renderPitchSpeed: () => undefined,
				resetPitchSpeed: () => undefined,
				resample: (clipId: string, request: unknown) => {
					resampleCalls.push([clipId, request]);
					return Promise.resolve(clipId);
				},
			},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const sourceRate = () => { const input = dom.one('[data-clip-properties-field="format-rate"]').querySelector('input'); assert.ok(input); return input; };
	const resampleButton = () => dom.one('[data-clip-properties-action="resample"]');
	return {
		resampleCalls, project: currentProject,
		sourceRate, resampleButton,
		render: async () => {
			await act(async () => root.render(<ClipPropertiesPanel
				run={operation => operation()}
				controller={controller}
				snapshot={{ project: currentProject, selectedClipId: 'shared-clip', capabilities }}
				copy={ENGLISH_COPY}
			/>));
		},
		editRate: async (rate: string) => {
			await act(async () => reactProps(sourceRate()).onChange({ currentTarget: { value: rate } }));
		},
		submitResample: async () => {
			await act(async () => {
				reactProps(resampleButton()).onClick({ currentTarget: resampleButton() });
				await Promise.resolve();
			});
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function project() {
	const source = createAudioSource({
		id: 'shared-source', storageKey: 'shared-source', name: 'Interview',
		frameCount: 1_000, channelCount: 1, sampleRate: 96_000, sampleFormat: 'int24',
	});
	const clip = createAudioClip({
		id: 'shared-clip', sourceId: source.id, title: 'Interview',
		timelineStartFrame: 0, durationFrames: 200,
		sourceStartFrame: 0, sourceDurationFrames: 200,
	});
	return createSoundscaperProject({
		id: 'project', title: 'Project', now: '2026-09-03T00:00:00.000Z',
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'shared-track', name: 'Track', clipIds: [clip.id] })],
	});
}
