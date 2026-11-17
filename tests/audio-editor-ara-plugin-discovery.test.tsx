/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { AraClipEditorDialog } from '../src/common/editor/ui/workspace/AraClipEditorSurface.tsx';
import NativeProcessingTheme from '../src/common/editor/ui/dialogs/NativeProcessingTheme.tsx';
import type { NativePluginAvailability } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import type { NativePluginRegistryView } from '../src/common/editor/native-plugin-host-contract.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

type Bridge = ComponentProps<typeof AraClipEditorDialog>['bridge'];
const existingRoot = { rootId: 'existing', origin: 'standard', name: 'Standard folder', admitted: true };
const customRoot = { rootId: 'new-folder', origin: 'custom', name: 'New folder', admitted: true };

for (const accepted of [false, true]) test(`ARA folder picker scans ${accepted ? 'only the newly selected folder' : 'nothing when cancelled'}`, async context => {
	const scanned: string[] = [];
	const view = await mount(context, {
		nativePluginAvailability: async () => availability(accepted ? [existingRoot, customRoot] : [existingRoot]),
		setNativePluginConsent: async request => request.action === 'add-custom-root'
			? accepted ? { status: 'admitted', root: customRoot } : { status: 'declined' }
			: { status: 'granted' },
		scanNativePlugins: async request => {
			scanned.push(request.rootId);
			return { status: 'described', scan: { format: 'vst3', status: 'ok', detail: '', entries: [] } };
		},
	});
	await view.click('Add VST3 folder…');
	assert.deepEqual(scanned, accepted ? [customRoot.rootId] : []);
});

test('manual ARA refresh wins when the first registry load returns later', async context => {
	const initial = deferred<NativePluginRegistryView>();
	let reads = 0;
	const view = await mount(context, { listNativePlugins: () => ++reads === 1 ? initial.promise : Promise.resolve(registry('Current editor')) });
	await view.click('Refresh plug-ins');
	assert.match(view.select.textContent, /Current editor/u);
	await act(async () => { initial.resolve(registry('Old editor')); await initial.promise; });
	assert.match(view.select.textContent, /Current editor/u);
	assert.doesNotMatch(view.select.textContent, /Old editor/u);
});

test('ARA disables Open clip when a refresh removes the selected installation', async context => {
	let current = registry('Vocal editor');
	const view = await mount(context, { listNativePlugins: async () => current });
	await act(async () => { reactProps(view.select).onChange({ target: { value: 'installation' } }); });
	assert.equal(view.button('Open clip').hasAttribute('disabled'), false);
	current = { entries: [] };
	await view.click('Refresh plug-ins');
	assert.equal(view.button('Open clip').hasAttribute('disabled'), true);
	assert.equal(reactProps(view.select).value, '');
});

test('ARA reports the desktop scan failure with its native diagnostic', async context => {
	const view = await mount(context, {
		nativePluginAvailability: async () => availability([existingRoot]),
		setNativePluginConsent: async () => true,
		scanNativePlugins: async () => ({ status: 'failed', code: 'scan-exit', message: 'The scan helper exited unexpectedly.' }),
	});
	await view.click('Enable and scan VST3 folders');
	assert.match(view.text, /ARA plug-ins could not be refreshed or scanned/u);
	assert.match(view.text, /The scan helper exited unexpectedly/u);
});

test('closing the ARA dialog while discovery is enabled retires the pending custom folder picker', async context => {
	const enabling = deferred<unknown>();
	const consent: string[] = [];
	const view = await mount(context, {
		applyNativeTierControl: () => enabling.promise,
		setNativePluginConsent: async request => { consent.push(request.action); return { status: 'declined' }; },
		scanNativePlugins: async () => assert.fail('A closed dialog must not initiate a scan.'),
	});
	await view.click('Add VST3 folder…');
	await view.click('Cancel');
	await act(async () => { enabling.resolve(true); await enabling.promise; });
	assert.deepEqual(consent, []);
});

function availability(roots: NativePluginAvailability['consent']['formats'][number]['roots']): NativePluginAvailability {
	return { enabled: true, quarantined: false, payload: { status: 'available', reason: null }, formats: [],
		consent: { scanningEnabled: true, formats: [{ format: 'vst3', supported: true, granted: true, roots }] },
		quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 } };
}

function registry(name: string): NativePluginRegistryView {
	return { entries: [{ entryId: 'editor', name, vendor: 'Fixture', format: 'VST3', eligible: true, ineligibleReason: null,
		installations: [{ installationId: 'installation', version: '1.0', allowed: true, selected: true, quarantined: false }] }] };
}

async function mount(context: TestContext, overrides: Partial<Bridge>) {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as HTMLElement);
	context.after(async () => {
		await act(async () => root.unmount());
		dom.restore();
		environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
	});
	const bridge: Bridge = {
		ara: { start: async () => ({ sessionId: 'session' }), write: async () => true, bind: async () => true,
			openEditor: async () => true, render: async () => ({ startFrame: 0, channels: [new Float32Array(1)] }), close: async () => true },
		nativePluginAvailability: async () => availability([]), listNativePlugins: async () => registry('Fixture'),
		setNativePluginInstallationAllowed: async () => undefined, selectNativePluginInstallation: async () => undefined,
		applyNativeTierControl: async () => undefined, ...overrides,
	};
	await act(async () => root.render(<NativeProcessingTheme><AraClipEditorDialog bridge={bridge}
		clipEditing={{ prepare: async () => { throw new Error('No clip should open during discovery.'); } }}
		controller={{ subscribe: () => () => undefined }} onClose={() => undefined} /></NativeProcessingTheme>));
	const button = (name: string) => {
		const element = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === name);
		assert.ok(element);
		return element;
	};
	return { button, get select() { return dom.one('select'); }, get text() { return dom.container.textContent; },
		async click(name: string) { await act(async () => { reactProps(button(name)).onClick(); }); } };
}
