/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { TrackAutomationSelectors } from '../src/common/editor/ui/timeline/TrackAutomationSelectors.tsx';
import type { TrackAutomationTargetV21 } from '../src/common/editor/track-automation-targets-v21.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const strip = Object.freeze({ kind: 'track' as const, id: 'voice' });

test('automation selectors expose disabled targets with their actual reason', () => {
	const available = target('gain', 'Volume', null);
	const reason = 'This processor requires the bounded schedule queue.';
	const blocked = target('pan', 'Pan', reason);
	const markup = renderToStaticMarkup(<TrackAutomationSelectors
		trackId="voice"
		targets={[available, blocked]}
		selectedTarget={available}
		copy={{ automationParameter: 'Automation parameter', automationMode: 'Automation mode' }}
		onTarget={() => undefined}
	/>);

	assert.match(markup, /Pan — This processor requires the bounded schedule queue\./u);
	assert.match(markup, /aria-label="Automation parameter"/u);
	assert.match(markup, /aria-label="Automation mode"/u);
});

test('choosing a parameter on a second track does not stop the first track writing automation', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const container = dom.container as unknown as HTMLElement;
	const root = createRoot(container);
	const volume = target('gain', 'Volume', null), pan = target('pan', 'Pan', null);
	const choices: string[] = [];
	const stopped: string[] = [];
	try {
		await act(async () => root.render(<TrackAutomationSelectors trackId="voice" targets={[volume, pan]} selectedTarget={volume}
			runtime={{ snapshot: { mode: 'write', laneId: 'different-track-volume', gestureActive: false },
				setMode: mode => { stopped.push(mode); } }}
			copy={{}} onTarget={key => { choices.push(key); }} />));
		const select = dom.one('[aria-label="Automation parameter"]');
		await act(async () => {
			reactProps(select).onChange!({ currentTarget: { value: pan.key } });
		});
		assert.deepEqual(choices, [pan.key]);
		assert.deepEqual(stopped, []);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
});

function target(
	parameterId: 'gain' | 'pan',
	label: string,
	disabledReason: string | null,
): TrackAutomationTargetV21 {
	const descriptor = stripParameterDescriptor({ kind: 'strip', strip, parameterId });
	return Object.freeze({
		key: descriptor.id,
		address: descriptor.address,
		descriptor,
		label,
		groupLabel: 'Track',
		effectId: null,
		edgeId: null,
		currentValue: descriptor.defaultValue,
		lane: null,
		disabledReason,
	});
}
