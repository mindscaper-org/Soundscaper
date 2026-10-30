/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { TrackHeightToolbarControls, trackHeightToolbarOptions } from '../src/common/editor/ui/toolbar/TrackHeightToolbarControls.tsx';
import { Icon } from '../vendor/audacity-design-system/components/src/Icon/Icon.tsx';
import { createTrackHeightMenu } from '../src/common/editor/ui/timeline/track-height-menu.ts';

Object.assign(globalThis, { React });

test('every workspace leaves the three height buttons off until opted in', () => {
	for (const id of ['classic', 'music', 'modern', 'audacity', 'video-editor']) {
		const preferences = createAudioEditorPreferencesV1({ workspace: { activeId: id } });
		for (const option of trackHeightToolbarOptions({})) assert.equal(preferences.workspace.toolbarButtons[option.id], false);
	}
	const empty = renderToStaticMarkup(<TrackHeightToolbarControls buttons={{}} copy={{}} disabled={false}
		controller={{ actions: { track: { decreaseAllHeights() {}, increaseAllHeights() {} }, timeline: { fitTracksToHeight() {} } } }} run={operation => operation()} />);
	assert.equal(empty, '');
});

test('opted in height buttons keep native arrows beside the upstream fit glyph', () => {
	const markup = renderToStaticMarkup(<TrackHeightToolbarControls buttons={{ 'decrease-track-heights': true, 'increase-track-heights': true, 'fit-tracks-height': true }}
		copy={{}} disabled={false} controller={{ actions: { track: { decreaseAllHeights() {}, increaseAllHeights() {} }, timeline: { fitTracksToHeight() {} } } }} run={operation => operation()} />);
	for (const label of ['Decrease all track heights', 'Increase all track heights', 'Fit tracks to height']) assert.match(markup, new RegExp(`aria-label="${label}"`, 'u'));
	for (const name of ['track-fit-height'] as const) {
		const icon = renderToStaticMarkup(<Icon name={name} />);
		assert.match(icon, /<svg/u);
		assert.match(icon, /stroke-width="1"/u);
	}
});

test('the track-height submenu keeps the existing relative height actions beside Fit', () => {
	const calls: unknown[] = [];
	const menu = createTrackHeightMenu({ copy: {}, disabled: false,
		onDecrease: () => calls.push('decrease'), onIncrease: () => calls.push('increase'), onFit: () => calls.push('fit') });
	assert.equal(menu.label, 'Track height');
	assert.deepEqual(menu.items.map(item => item.label), ['Decrease track height', 'Increase track height', 'Fit to height']);
	for (const item of menu.items) item.onClick();
	assert.deepEqual(calls, ['decrease', 'increase', 'fit']);
});

test('track visual controls form one group and height edits dispatch to the clicked row', async () => {
	const module = await import('../src/common/editor/ui/timeline/timeline-menu-model.js');
	type Item = { id?: string; divider?: boolean; label?: unknown; items?: Item[]; onClick?: () => unknown };
	const createMenu = module.createTimelineMenuModel as (input: unknown) => { trackMenuItems: Item[] };
	const calls: unknown[] = [];
	const track = { id: 'track', type: 'label', clipIds: [], labels: [] };
	const copy = new Proxy({} as Record<string, string>, { get: (_target, key) => String(key) });
	const model = createMenu({
		controller: { actions: { track: { decreaseHeight: (id: string) => calls.push(['decrease', id]),
			increaseHeight: (id: string) => calls.push(['increase', id]) },
			timeline: { fitTracksToHeight: (...args: unknown[]) => calls.push(['fit', ...args]) } } },
		snapshot: { capabilities: {}, timeline: {}, preferences: {} }, locale: 'en', copy,
		showArmControls: false, mutationsBlocked: false, productId: 'soundscaper', capabilities: {},
		state: { trackMenu: { trackId: 'track' }, waveformRulerState: {}, loopPreview: null },
		model: { project: { tracks: [track], clips: [], sources: [] }, sampleRate: 48000, availableTrackHeight: 600 },
		menuActions: { run: (operation: () => unknown) => operation() },
	});
	const height = model.trackMenuItems.findIndex(item => item.id === 'local://track-height');
	assert.equal(model.trackMenuItems[height - 1]?.id, 'track-label-text-size');
	assert.equal(model.trackMenuItems[height + 1]?.divider, true);
	for (const item of model.trackMenuItems[height]!.items ?? []) item.onClick?.();
	assert.deepEqual(calls, [['decrease', 'track'], ['increase', 'track'], ['fit', ['track'], 600]]);
});
