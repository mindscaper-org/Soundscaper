/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { useTrackAutomationControls } from '../src/common/editor/ui/timeline/useTrackAutomationControls.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly checked?: boolean;
	readonly onClick?: () => unknown;
}
type MenuFactory = (input: unknown) => { readonly trackMenuItems: readonly MenuItem[] };

async function mountControls(enabled: boolean) {
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const original = createSoundscaperProject({ id: 'menu-opt-in',
		tracks: Array.from({ length: 100 }, (_, index) => createAudioTrack({ id: `track-${index}` })) });
	let inventoryReads = 0;
	const project = { ...original, get automationLanes() { inventoryReads += 1; return original.automationLanes; } };
	let model: ReturnType<typeof useTrackAutomationControls> | null = null;
	function View() { model = useTrackAutomationControls(project, enabled); return null; }
	await act(async () => root.render(<View />));
	return {
		project,
		current() { assert.ok(model); return model; },
		inventoryReads: () => inventoryReads,
		async close() { try { await act(async () => root.unmount()); } finally { dom.restore(); } },
	};
}

function trackMenu(factory: MenuFactory, mounted: Awaited<ReturnType<typeof mountControls>>,
	productId = 'soundscaper', audioAutomation = true) {
	const capabilities = { audioAutomation };
	return factory({
		controller: { actions: { track: { update: () => undefined } } },
		snapshot: { capabilities }, locale: 'en', copy: ENGLISH_COPY,
		showArmControls: false, onToggleArmControls: () => undefined, mutationsBlocked: false,
		state: {
			trackMenu: { trackId: 'track-42' }, outputMenu: null, trackColorMenu: null, clipMenu: null,
			trackRulerFlyout: null, waveformRulerState: null, setTrackColorMenu: () => undefined,
			setWaveformRulerState: () => undefined, loopPreview: null,
		},
		model: { project: mounted.project, sampleRate: mounted.project.sampleRate },
		menuActions: { run: (operation: () => unknown) => operation() }, onOpenSurface: () => undefined,
		productId, capabilities, automationControls: mounted.current(),
	}).trackMenuItems.find(item => item.id === 'track-add-automation');
}

async function menuFactory(): Promise<MenuFactory> {
	const module = await import('../src/common/editor/ui/timeline/timeline-menu-model.js') as unknown as {
		createTimelineMenuModel: MenuFactory;
	};
	return module.createTimelineMenuModel;
}

test('the real track menu opts into a lazy automation inventory and hides it again', async () => {
	const createMenu = await menuFactory(), mounted = await mountControls(true);
	try {
		assert.equal(mounted.current().targetsByTrackId.size, 0);
		assert.equal(mounted.current().visibleTrackIds.size, 0);
		const item = trackMenu(createMenu, mounted);
		assert.ok(item, 'Add automation stays reachable before any track inventory is constructed');
		assert.equal(item.checked, false);
		assert.equal(mounted.inventoryReads(), 0, 'opening the menu must not scan hidden inventories');
		await act(async () => { item.onClick?.(); });
		assert.deepEqual([...mounted.current().visibleTrackIds], ['track-42']);
		assert.equal(mounted.current().targetsByTrackId.size, 1);
		assert.equal(mounted.current().selectedTargetByTrackId.get('track-42')?.descriptor.address.kind, 'strip');
		assert.equal(mounted.current().selectedTargetByTrackId.get('track-42')?.descriptor.address.parameterId, 'gain');
		assert.ok(mounted.inventoryReads() > 0, 'the opted-in track prepares its targets');
		const visible = trackMenu(createMenu, mounted);
		assert.ok(visible); assert.equal(visible.checked, true);
		await act(async () => { visible.onClick?.(); });
		assert.equal(mounted.current().targetsByTrackId.size, 0);
		assert.equal(mounted.current().visibleTrackIds.size, 0);
		const reads = mounted.inventoryReads();
		const hidden = trackMenu(createMenu, mounted);
		assert.ok(hidden); assert.equal(hidden.checked, false);
		assert.equal(mounted.inventoryReads(), reads, 'hiding controls restores the zero-inventory menu path');
	} finally { await mounted.close(); }
});

for (const [productId, enabled] of [['soundscaper', false], ['framescaper', true]] as const) {
	test(`${productId} keeps automation absent when the product capability is unavailable (${enabled})`, async () => {
		const createMenu = await menuFactory(), mounted = await mountControls(false);
		try {
			assert.equal(trackMenu(createMenu, mounted, productId, enabled), undefined);
			assert.equal(mounted.current().targetsByTrackId.size, 0);
			assert.equal(mounted.inventoryReads(), 0);
		} finally { await mounted.close(); }
	});
}
