/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	choosePreference, closePreferences, createEditorRootSession, labeledInput, openPreferences,
} from './helpers/editor-root-session.ts';

function preferenceField(value: unknown, section: string, key: string): unknown {
	if (!value || typeof value !== 'object') return undefined;
	const part: unknown = Reflect.get(value, section);
	return part && typeof part === 'object' ? Reflect.get(part, key) : undefined;
}

test('actual browser Preferences routes to General and persists Advanced performance into a fresh controller', async context => {
	const session = await createEditorRootSession(context);
	const { dom, controller } = session;
	const dialog = await session.preferences();
	assert.match(dom.element('[role="tab"]', dialog).textContent ?? '', /General$/u);
	assert.equal(dom.byText('[role="tab"]', /General$/u, dialog).getAttribute('aria-selected'), 'true');
	assert.ok(dialog.querySelector('[role="group"][aria-label="Language"]'));
	assert.equal(dialog.querySelector('[data-external-ffmpeg-preference="true"]'), null);
	assert.equal(dialog.querySelector('[role="group"][aria-label="Optimize for"]'), null);
	await dom.click(dom.byText('[role="tab"]', /Advanced$/u, dialog));
	const group = dom.element('[role="group"][aria-label="Optimize for"]', dialog);
	assert.match(group.textContent ?? '', /Memory/u);
	assert.equal(preferenceField(controller.getSnapshot().preferences, 'performance', 'optimizeFor'), 'memory');
	await choosePreference(dom, group, 'Speed');
	await dom.wait(async () => preferenceField(await session.storedPreferences(), 'performance', 'optimizeFor') === 'speed',
		'the real preference repository durably writes Speed');
	assert.equal(preferenceField(controller.getSnapshot().preferences, 'performance', 'optimizeFor'), 'speed');
	const fresh = await session.reopen();
	assert.equal(preferenceField(fresh.controller.getSnapshot().preferences, 'performance', 'optimizeFor'), 'speed');
	const reopened = await openPreferences(dom);
	await dom.click(dom.byText('[role="tab"]', /Advanced$/u, reopened));
	assert.match(dom.element('[role="group"][aria-label="Optimize for"]', reopened).textContent ?? '', /Speed/u);
	dom.assertHealthy();
});

test('actual Program start radio delegation persists the choice beyond the original root', async context => {
	const session = await createEditorRootSession(context);
	const { dom, controller } = session;
	const dialog = await session.preferences();
	const group = dom.element('[role="radiogroup"][aria-label="Program start"]', dialog);
	assert.equal(group.getAttribute('data-program-start'), 'continue-last-session');
	assert.equal(labeledInput(dom, 'Continue last session', group).checked, true);
	const choice = labeledInput(dom, 'Start with new project', group);
	assert.equal(choice.checked, false);
	await dom.click(choice);
	await dom.wait(async () => preferenceField(await session.storedPreferences(), 'startup', 'mode') === 'new-project',
		'the actual preference write completes before its controller is disposed');
	assert.equal(choice.checked, true);
	assert.equal(preferenceField(controller.getSnapshot().preferences, 'startup', 'mode'), 'new-project');
	await closePreferences(dom, dialog);
	assert.equal(dom.element('[role="radiogroup"][aria-label="Program start"]', await session.preferences())
		.getAttribute('data-program-start'), 'new-project');
	const fresh = await session.reopen();
	assert.equal(preferenceField(fresh.controller.getSnapshot().preferences, 'startup', 'mode'), 'new-project');
	dom.assertHealthy();
});

test('the actual track menu opens combined waveform and spectrogram Preferences', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	const track = dom.element('[data-track-row]');
	const trigger = [...track.querySelectorAll('button')].find(node => /^(?:Track menu|Track options)$/u.test(node.getAttribute('aria-label') ?? ''));
	assert.ok(trigger);
	await dom.click(trigger);
	await dom.wait(() => !!dom.document.querySelector('.audio-editor-track-menu [role="menuitem"]'), 'the actual track menu opens');
	const visualization = dom.byText('[role="menuitem"]', /^Track visualization/u, dom.element('.audio-editor-track-menu'));
	await dom.key(visualization, 'ArrowRight');
	await dom.click(dom.byText('[role="menuitem"]', /^Track display/u, visualization));
	await dom.wait(() => !!dom.document.querySelector('[role="dialog"][aria-label="Editor preferences"]'), 'Track display opens actual Preferences');
	const dialog = dom.element('[role="dialog"][aria-label="Editor preferences"]');
	assert.equal(dom.byText('[role="tab"]', /Track display$/u, dialog).getAttribute('aria-selected'), 'true');
	assert.equal([...dialog.querySelectorAll('[role="tab"]')].some(node => /^(Waveform|Spectrogram)$/u.test(node.textContent ?? '')), false);
	assert.ok(dialog.querySelector('[data-spectrogram-settings]'));
	assert.ok(dialog.querySelector('[role="group"][aria-label="Default view"]'));
	const settings = dom.element('[data-waveform-visualization-settings]', dialog);
	assert.equal(labeledInput(dom, 'Low/mid crossover (Hz)', settings).value, '250');
	assert.equal(labeledInput(dom, 'Mid/high crossover (Hz)', settings).value, '4000');
	dom.assertHealthy();
});

test('actual Effects preference rebuilds the application Effect menu from durable product state', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	const effect = () => dom.byText('[data-application-menubar] [role="menuitem"]', 'Effect');
	await dom.click(effect());
	await dom.wait(() => !!dom.document.querySelector('[role="menu"][aria-label="Effect"]'), 'the actual Effect menu opens');
	assert.ok(dom.byText('[role="menuitem"]', /^Volume and compression/u,
		dom.element('[role="menu"][aria-label="Effect"]')));
	await dom.key(effect(), 'Escape');
	const dialog = await session.preferences();
	await dom.click(dom.byText('[role="tab"]', /Effects$/u, dialog));
	await choosePreference(dom, dom.element('[role="group"][aria-label="Effect menu organization"]', dialog), 'Sort by effect name');
	await dom.wait(async () => preferenceField(await session.storedPreferences(), 'effects', 'menuOrganization') === 'sortby:name',
		'the actual effect-menu preference is stored');
	await closePreferences(dom, dialog);
	await dom.click(effect());
	const menu = dom.element('[role="menu"][aria-label="Effect"]');
	assert.equal([...menu.querySelectorAll('[role="menuitem"]')]
		.some(node => /^Volume and compression/u.test(node.textContent?.trim() ?? '')), false);
	const amplify = dom.byText('[role="menuitem"]', /^Amplify(?: —|$)/u, menu);
	assert.equal(amplify.getAttribute('aria-disabled'), 'true');
	const fresh = await session.reopen();
	assert.equal(preferenceField(fresh.controller.getSnapshot().preferences, 'effects', 'menuOrganization'), 'sortby:name');
	dom.assertHealthy();
});

test('actual Advanced server input validates, normalizes and persists through the product controller', async context => {
	const session = await createEditorRootSession(context);
	const { dom, controller } = session;
	const dialog = await session.preferences();
	assert.equal(dialog.querySelector('input[type="url"]'), null);
	await dom.click(dom.byText('[role="tab"]', /Advanced$/u, dialog));
	const input = labeledInput(dom, 'Server URL', dialog);
	assert.equal(input.value, 'https://api.audio.com');
	const save = dom.byText('button', 'Save server', dialog);
	assert.equal(save.hasAttribute('disabled'), true);
	const initial = await session.storedPreferences();
	await dom.setValue(input, 'http://audiocity.example');
	await dom.click(save);
	assert.equal(input.getAttribute('aria-invalid'), 'true');
	assert.match(dom.element('[role="alert"]', dialog).textContent ?? '', /HTTPS server URL/u);
	assert.deepEqual(await session.storedPreferences(), initial);
	assert.equal(preferenceField(controller.getSnapshot().preferences, 'advanced', 'audioComServerUrl'), 'https://api.audio.com');
	await dom.setValue(input, 'https://audiocity.example/');
	await dom.key(input, 'Enter');
	await dom.wait(async () => preferenceField(await session.storedPreferences(), 'advanced', 'audioComServerUrl') === 'https://audiocity.example',
		'the actual server preference writer completes');
	assert.equal(input.value, 'https://audiocity.example');
	assert.equal(dialog.querySelector('[role="alert"]'), null);
	const fresh = await session.reopen();
	assert.equal(preferenceField(fresh.controller.getSnapshot().preferences, 'advanced', 'audioComServerUrl'), 'https://audiocity.example');
	const reopened = await openPreferences(dom);
	await dom.click(dom.byText('[role="tab"]', /Advanced$/u, reopened));
	assert.equal(labeledInput(dom, 'Server URL', reopened).value, 'https://audiocity.example');
	await dom.click(dom.byText('button', 'Use audio.com', reopened));
	await dom.wait(async () => preferenceField(await fresh.environment.store.loadSetting('soundscaper:audio-editor-preferences-v1'),
		'advanced', 'audioComServerUrl') === 'https://api.audio.com', 'Use audio.com restores the actual stored server');
	dom.assertHealthy();
});

for (const product of ['soundscaper', 'framescaper'] as const) {
	test(`actual ${product} saving and temporary-project controls persist across a fresh editor root`, async context => {
		const session = await createEditorRootSession(context, product);
		const { dom, controller } = session;
		const dialog = await session.preferences();
		const saving = dom.element('[role="group"][aria-label="Auto-saving"]', dialog);
		assert.match(saving.textContent ?? '', /On/u);
		assert.equal(dialog.querySelector('[role="group"][aria-label="Ask to save projects when closing"]'), null);
		await choosePreference(dom, saving, 'Off');
		await dom.click(dom.byText('[role="tab"]', /Advanced$/u, dialog));
		const limit = labeledInput(dom, 'Temporary project limit', dialog);
		assert.equal(limit.value, '10');
		await dom.setValue(limit, '4');
		await dom.key(limit, 'Enter');
		await dom.wait(() => preferenceField(controller.getSnapshot().preferences, 'temporaryData', 'maximumProjects') === 4,
			'the actual number input commits its draft on Enter/blur');
		assert.equal(limit.value, '4');
		await dom.click(dom.element('[role="checkbox"][aria-label="Maximum number of temporary projects"]', dialog));
		assert.equal(limit.disabled, true);
		assert.equal(labeledInput(dom, 'Temporary data folder', dialog).value, 'Browser storage');
		await dom.wait(async () => {
			const preferences: unknown = await session.storedPreferences();
			return preferenceField(preferences, 'saving', 'autoSaving') === false
				&& preferenceField(preferences, 'temporaryData', 'maximumProjects') === 4
				&& preferenceField(preferences, 'temporaryData', 'limitProjects') === false;
		}, 'the actual product preference store commits all saving settings');
		const fresh = await session.reopen();
		assert.equal(preferenceField(fresh.controller.getSnapshot().preferences, 'saving', 'autoSaving'), false);
		assert.deepEqual(fresh.controller.getSnapshot().preferences.temporaryData, { maximumProjects: 4, limitProjects: false });
		const reopened = await openPreferences(dom);
		assert.match(dom.element('[role="group"][aria-label="Auto-saving"]', reopened).textContent ?? '', /Off/u);
		await dom.click(dom.byText('[role="tab"]', /Advanced$/u, reopened));
		assert.equal(labeledInput(dom, 'Temporary project limit', reopened).value, '4');
		assert.equal(labeledInput(dom, 'Temporary project limit', reopened).disabled, true);
		dom.assertHealthy();
	});
}

test('actual Editing controls reveal dependent choices and durably restore them in a fresh product root', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	const dialog = await session.preferences();
	await dom.click(dom.byText('[role="tab"]', /Editing$/u, dialog));
	const editing = dom.element('[data-editing-preferences]', dialog);
	assert.equal(editing.querySelectorAll('[data-editing-preferences-section]').length, 7);
	const checkbox = (name: string) => dom.element(`[role="checkbox"][aria-label="${name}"]`, editing);
	assert.equal(checkbox('Apply 2 ms fades to new clips').getAttribute('aria-checked'), 'true');
	assert.equal(checkbox('Apply effects to all audio when no selection is made').getAttribute('aria-checked'), 'true');
	assert.equal(editing.querySelector('[role="radiogroup"][aria-label="When closing the gap, do the following"]'), null);
	await dom.click(labeledInput(dom, 'Close gap (ripple)', editing));
	const closeGap = dom.element('[role="radiogroup"][aria-label="When closing the gap, do the following"]', editing);
	await dom.click(labeledInput(dom, 'All clips on all tracks move back to fill the gap', closeGap));
	assert.equal(editing.querySelector('[role="radiogroup"][aria-label="When making room for pasted audio, do the following"]'), null);
	await dom.click(labeledInput(dom, 'Paste pushes other clips', editing));
	const paste = dom.element('[role="radiogroup"][aria-label="When making room for pasted audio, do the following"]', editing);
	await dom.click(labeledInput(dom, 'Pasting audio pushes all clips on all tracks', paste));
	assert.equal(editing.querySelector('[role="group"][aria-label="Workspaces"]'), null);
	await dom.click(labeledInput(dom, 'Depending on workspace', editing));
	assert.ok(editing.querySelector('[role="group"][aria-label="Workspaces"]'));
	await choosePreference(dom, dom.element('[role="group"][aria-label="Zoom state 1:"]', editing), 'Seconds');
	await choosePreference(dom, dom.element('[role="group"][aria-label="Zoom state 2:"]', editing), 'Max Zoom');
	await dom.click(checkbox('Always convert to mono without prompt'));
	const expected = {
		deleteBehavior: 'close-gap', closeGapBehavior: 'all-tracks', pasteBehavior: 'insert',
		pasteInsertBehavior: 'all-tracks', asymmetricStereoHeights: 'workspace-dependent',
		zoomTogglePreset1: 'seconds', zoomTogglePreset2: 'max-zoom', alwaysConvertToMono: true,
	};
	await dom.wait(async () => {
		const stored: unknown = await session.storedPreferences();
		if (!stored || typeof stored !== 'object') return false;
		const value: unknown = Reflect.get(stored, 'editing');
		return !!value && typeof value === 'object'
			&& Object.entries(expected).every(([key, item]) => Reflect.get(value, key) === item);
	}, 'all actual Editing preferences reach the product repository before disposal');
	await closePreferences(dom, dialog);
	await session.reopen();
	const current: unknown = session.controller.getSnapshot().preferences.editing;
	assert.ok(current && typeof current === 'object');
	for (const [key, value] of Object.entries(expected)) assert.equal(Reflect.get(current, key), value, key);
	const reopened = await openPreferences(dom);
	await dom.click(dom.byText('[role="tab"]', /Editing$/u, reopened));
	assert.equal(labeledInput(dom, 'All clips on all tracks move back to fill the gap', reopened).checked, true);
	assert.equal(labeledInput(dom, 'Pasting audio pushes all clips on all tracks', reopened).checked, true);
	assert.equal(labeledInput(dom, 'Depending on workspace', reopened).checked, true);
	assert.equal(dom.element('[role="checkbox"][aria-label="Always convert to mono without prompt"]', reopened)
		.getAttribute('aria-checked'), 'true');
	assert.match(dom.element('[role="group"][aria-label="Zoom state 1:"]', reopened).textContent ?? '', /Seconds/u);
	assert.match(dom.element('[role="group"][aria-label="Zoom state 2:"]', reopened).textContent ?? '', /Max Zoom/u);
	dom.assertHealthy();
});

test('an owner failure after the real editor mounts closes its product session and restores every replaced global', async context => {
	const names = [
		'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
		'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
		'HTMLIFrameElement', 'HTMLCanvasElement', 'HTMLMediaElement', 'HTMLAudioElement', 'SVGElement',
		'Document', 'DocumentFragment', 'MutationObserver', 'Event', 'EventTarget', 'MouseEvent',
		'KeyboardEvent', 'CustomEvent', 'FocusEvent', 'DOMException', 'AbortController', 'AbortSignal',
		'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'addEventListener',
		'removeEventListener', 'dispatchEvent', 'IS_REACT_ACT_ENVIRONMENT', 'React',
		'AudioContext', 'OfflineAudioContext', 'AudioWorkletNode', 'AudioBuffer', 'AudioNode',
		'AudioParam', 'AudioBufferSourceNode', 'BaseAudioContext',
	];
	const before = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
	const session = await createEditorRootSession(context);
	const { controller, dom } = session;
	assert.ok(session.container.querySelector('[data-audio-editor-ready], [data-editor-ready="true"]'));
	await assert.rejects(async () => {
		try {
			await session.preferences();
			dom.assertHealthy();
			throw new Error('planned owner failure after actual product mount');
		} finally { await dom.dispose(); }
	}, /planned owner failure after actual product mount/u);
	assert.deepEqual(names.map(name => Object.getOwnPropertyDescriptor(globalThis, name)), before);
	assert.equal(session.container.isConnected, false);
	await assert.rejects(async () => controller.actions.project.create(), /disposed/u);
	// A fresh owner also demonstrates that the previous SDK global lease and DOM
	// realm do not remain active after the exceptional path.
	const fresh = await createEditorRootSession(context);
	await fresh.preferences();
	fresh.dom.assertHealthy();
	await fresh.dom.dispose();
	assert.deepEqual(names.map(name => Object.getOwnPropertyDescriptor(globalThis, name)), before);
});
