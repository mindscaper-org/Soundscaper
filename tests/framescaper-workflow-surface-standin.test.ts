/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ParameterAddress } from '../src/common/editor/parameter-address.ts';
import * as standIn from '../src/framescaper/editor-soundscaper-workflow-product-runtime.tsx';

const {
	TrackAutomationCurveMenu,
	TrackAutomationOverlay,
	TrackAutomationRuntimeProvider,
	TrackAutomationSelectors,
	beginParameterAutomationGestureV21,
	createParameterAutomationControlRouterV21,
	createSoundscaperWorkflowApplicationMenuItems,
	parameterAutomationCaptureAvailableV21,
	resolveSoundscaperMasteringSequenceCopy,
	resolveSoundscaperRoutingGraphCopy,
	resolveTrackAutomationCopy,
	useSoundscaperWorkflowWorkspace,
	useTrackAutomationControls,
	useTrackAutomationRuntime,
} = standIn;

const STAND_IN_SOURCE = source('../src/framescaper/editor-soundscaper-workflow-product-runtime.tsx');
const SOUNDSCAPER_SOURCE = source('../src/common/editor/ui/soundscaper-workflow-product-runtime.tsx');

const LANE_ID = 'lane-1';
const ADDRESS: ParameterAddress = {
	kind: 'strip',
	strip: { kind: 'track', id: 'track-1' },
	parameterId: 'gain',
};

function source(relativePath: string): string {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

function reExportedNames(moduleSource: string): readonly string[] {
	const names: string[] = [];
	for (const match of moduleSource.matchAll(/export\s*\{([^}]*)\}\s*from/gu)) {
		for (const clause of match[1].split(',')) {
			const name = clause.trim().split(/\s+as\s+/u).pop()?.trim();
			if (name) names.push(name);
		}
	}
	return names.sort();
}

test('the framescaper stand-in exports exactly the names the soundscaper workflow runtime re-exports', () => {
	const soundscaperNames = reExportedNames(SOUNDSCAPER_SOURCE);

	assert.deepEqual(Object.keys(standIn).sort(), soundscaperNames);
});

test('the stand-in pulls no soundscaper workflow code or stylesheet into the framescaper bundle', () => {
	const valueImports = STAND_IN_SOURCE.split('\n').filter((line) => /^import\s+(?!type\b)/u.test(line));

	assert.deepEqual(valueImports, []);
	assert.equal(STAND_IN_SOURCE.includes('.css'), false);
});

test('the automation runtime provider passes ordinary children through', () => {
	const children = 'content';
	assert.equal(TrackAutomationRuntimeProvider({ children }), children);
	assert.equal(TrackAutomationRuntimeProvider({ children: null }), null);
	const siblings = [children, children];
	assert.equal(TrackAutomationRuntimeProvider({ children: siblings }), siblings);
});

test('the automation runtime hook reports no live automation runtime to any consumer', () => {
	assert.equal(useTrackAutomationRuntime(), null);
});

test('the Framescaper workflow workspace hook returns no runtime or surface', () => {
	const surfaces: string[] = [];
	const controller = { actions: {} };

	const workspace = useSoundscaperWorkflowWorkspace({
		productId: 'framescaper',
		controller,
		project: { id: 'project-1', tracks: [{ id: 'track-1', type: 'audio' }] },
		selectedTrackId: 'track-1',
		openSurface(surface: string) { surfaces.push(surface); },
	});

	assert.equal(workspace, null);
	assert.deepEqual(surfaces, []);
});

test('the automation controls model is empty for a Framescaper project', () => {
	const project = {
		id: 'project-1',
		tracks: [{ id: 'track-1', type: 'audio' }, { id: 'track-2', type: 'audio' }],
		automationLanes: [{ id: LANE_ID, address: ADDRESS }],
	};

	const model = useTrackAutomationControls(project, false, null);

	assert.equal(model.visibleTrackIds.size, 0);
	assert.equal(model.targetsByTrackId.size, 0);
	assert.equal(model.selectedTargetByTrackId.size, 0);
});

test('the automation controls model reports every track hidden and its mutators change nothing', () => {
	const model = useTrackAutomationControls({ id: 'project-1' }, false, null);

	assert.equal(model.isVisible('track-1'), false);
	assert.equal(model.toggle('track-1'), undefined);
	assert.equal(model.selectTarget('track-1', 'target-key'), undefined);
	assert.equal(model.isVisible('track-1'), false);
	assert.equal(model.visibleTrackIds.size, 0);
	assert.equal(model.targetsByTrackId.get('track-1'), undefined);
});

test('the timeline automation components render nothing for any props', () => {
	const components = [TrackAutomationCurveMenu, TrackAutomationOverlay, TrackAutomationSelectors];

	for (const component of components) {
		const render = component as unknown as (props?: unknown) => unknown;
		assert.equal(render({ copy: {}, target: null, onSelect: () => undefined }), null);
	}
});

test('the automation copy catalog carries only the add-automation label, in english for every locale', () => {
	const english = resolveTrackAutomationCopy('en-GB');

	assert.deepEqual(english, { addAutomation: 'Add automation' });
	assert.deepEqual(resolveTrackAutomationCopy('de-DE'), english);
	assert.equal(english.automationMode, undefined);
});

test('the Framescaper workflow application menu is empty in every group', () => {
	const calls: string[] = [];
	const menu = createSoundscaperWorkflowApplicationMenuItems({
		productId: 'framescaper',
		capabilities: {},
		project: { id: 'project-1', tracks: [{ id: 'track-1', type: 'audio' }] },
		selectedTrackId: 'track-1',
		freezeStatus: 'fresh',
		freezeActionsAvailable: true,
		editingBlocked: false,
	}, {
		openMasteringSequences() { calls.push('openMasteringSequences'); },
		freeze(operation, trackId) { calls.push(`${operation}:${trackId}`); },
	});

	assert.deepEqual(menu, { tracks: [], mixer: [], effect: [], analyze: [], tools: [] });
	assert.deepEqual(calls, []);
});

test('the mastering sequence copy catalog is empty even when the host supplies overrides', () => {
	const copy = resolveSoundscaperMasteringSequenceCopy({
		close: 'Schliessen',
		masteringSequences: 'Mastering-Sequenzen…',
	});

	assert.deepEqual(copy, {});
	assert.equal(copy.close, undefined);
	assert.deepEqual(resolveSoundscaperMasteringSequenceCopy(), {});
});

test('the routing graph copy carries only the two labels the mixer button renders', () => {
	const copy = resolveSoundscaperRoutingGraphCopy();

	assert.deepEqual(copy, { routing: 'Routing graph', channelStrips: 'Channel strips' });
	assert.equal(copy.zoomIn, undefined);
	assert.deepEqual(resolveSoundscaperRoutingGraphCopy({}), copy);
});

test('host overrides replace the two routing labels the stand-in keeps and unknown keys are dropped', () => {
	const copy = resolveSoundscaperRoutingGraphCopy({
		routing: 'Signalweg',
		channelStrips: 'Kanalzüge',
		zoomIn: 'Vergrössern',
	});

	assert.deepEqual(copy, { routing: 'Signalweg', channelStrips: 'Kanalzüge' });
});

test('an empty routing label override falls back to the shipped label', () => {
	const copy = resolveSoundscaperRoutingGraphCopy({ routing: '', channelStrips: undefined });

	assert.deepEqual(copy, { routing: 'Routing graph', channelStrips: 'Channel strips' });
});

test('the parameter automation router refuses every control event and never owns an address', () => {
	const router = createParameterAutomationControlRouterV21();
	router.setContext({ runtime: null, project: { automationLanes: [] } });

	assert.equal(router.captureAvailable(ADDRESS), false);
	assert.equal(router.begin(ADDRESS, 0.5), false);
	assert.equal(router.owns(ADDRESS), false);
	assert.equal(router.preview(ADDRESS, 0.75), false);
	assert.equal(router.release(ADDRESS, 1), false);
	assert.equal(router.release(ADDRESS), false);
	assert.equal(router.cancel(ADDRESS), false);
	assert.equal(router.cancel(), false);
	assert.equal(router.performAtomic(ADDRESS, 0.25), false);
});

test('automation capture is unavailable without a Framescaper runtime', () => {
	assert.equal(parameterAutomationCaptureAvailableV21({ runtime: null, address: ADDRESS }), false);
});

test('beginning a Framescaper gesture yields no session', () => {
	assert.equal(beginParameterAutomationGestureV21({ runtime: null, address: ADDRESS }, 0.5), null);
});
