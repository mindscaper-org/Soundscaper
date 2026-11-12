/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorRootSession } from './helpers/editor-root-session.ts';

type Session = Awaited<ReturnType<typeof createEditorRootSession>>;

function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

function tracks(project: unknown): Record<string, unknown>[] {
	const value = record(project).tracks;
	assert.ok(Array.isArray(value));
	return value.map(record);
}

function button(session: Session, label: string, root: ParentNode = session.dom.document): HTMLButtonElement {
	const node = [...root.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || (node.querySelector('.button__text')?.textContent?.trim() ?? node.textContent?.trim()) === label);
	assert.ok(node instanceof session.dom.window.HTMLButtonElement, `Missing real button: ${label}`);
	return node;
}

function items(root: ParentNode): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')];
}

function itemLabel(node: HTMLElement): string {
	return node.querySelector('.context-menu-item-label, .add-track-flyout__option-label')?.textContent?.trim() ?? node.textContent?.trim() ?? '';
}

function item(session: Session, root: ParentNode, label: string): HTMLElement {
	const result = items(root).find(node => itemLabel(node) === label);
	assert.ok(result instanceof session.dom.window.HTMLElement, `Missing real menu item: ${label}`);
	return result;
}

async function menu(session: Session, name: string, path: readonly string[] = []): Promise<HTMLElement> {
	const { dom } = session;
	await dom.click(dom.byText('[data-application-menubar] [role="menuitem"]', name));
	await dom.wait(() => !!dom.document.querySelector(`[role="menu"][aria-label="${name}"]`), `actual ${name} menu opens`);
	let current = dom.element(`[role="menu"][aria-label="${name}"]`);
	for (const label of path) {
		const parent = item(session, current, label);
		await dom.click(parent);
		await dom.wait(() => !!parent.querySelector('[role="menu"]'), `actual ${label} submenu opens`);
		current = dom.element('[role="menu"]', parent);
	}
	return current;
}

async function choose(session: Session, heading: string, label: string, path: readonly string[] = []): Promise<void> {
	await session.dom.click(item(session, await menu(session, heading, path), label));
}

async function dialog(session: Session, name: string): Promise<HTMLElement> {
	await session.dom.wait(() => !!session.dom.document.querySelector(`[role="dialog"][aria-label="${name}"]`), `actual ${name} dialog opens`);
	return session.dom.element(`[role="dialog"][aria-label="${name}"]`);
}

async function preferences(session: Session): Promise<Record<string, unknown>> {
	let value: unknown;
	await session.dom.react.act(async () => { value = await session.storedPreferences(); });
	return record(value);
}

test('actual menus retain literal capability inventories, visibility glyphs and product dialog routes', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	const before = structuredClone(session.controller.project);
	const nativeContext = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
	await dom.react.act(async () => { dom.element('.audio-editor-ruler-corner', session.container).dispatchEvent(nativeContext); });
	assert.equal(nativeContext.defaultPrevented, true);

	let current = await menu(session, 'View');
	const eye = (label: string) => item(session, current, label).querySelector(':scope > .context-menu-item-content .context-menu-item-icon .musescore-icon');
	assert.equal(item(session, current, 'Vertical rulers').getAttribute('aria-checked'), 'true');
	assert.equal(eye('Vertical rulers')?.textContent, '\uEF53');
	assert.equal(item(session, current, 'RMS in waveform').getAttribute('aria-checked'), 'false');
	assert.equal(eye('RMS in waveform')?.textContent, '\uEF54');
	for (const label of ['Fade shape handles', 'Clipping in waveform', 'Master track', 'Markers', 'Status bar']) assert.ok(eye(label));
	assert.equal(eye('Enable multi-track recording') === null, true);
	current = await menu(session, 'Window');
	for (const label of ['Project bin', 'Video preview', 'Effects']) assert.ok(eye(label));
	assert.equal(items(current).some(node => itemLabel(node) === 'Tracks panel'), false);
	current = await menu(session, 'View', ['Snapping']);
	assert.equal(eye('Snap to grid') === null, true);
	await dom.key(current, 'Escape');
	await dom.key(dom.element('[data-application-menubar] [role="menuitem"]'), 'Escape');

	for (const [heading, absent] of [
		['File', ['Export selected audio', 'Quit']], ['View', ['Show piano roll']],
		['Tracks', ['Sync-lock tracks', 'MIDI track']], ['Generate', ['Plugin manager']],
		['Effect', ['Plugin manager']], ['Analyze', ['Plugin manager']],
		['Tools', ['Plugin manager', 'Screenshot tools', 'Run benchmark', 'Reset configuration', 'Sample data import', 'Sample data export']],
	] as const) {
		current = await menu(session, heading);
		const labels = items(current).map(itemLabel);
		for (const label of absent) assert.equal(labels.includes(label), false, `${heading} omits ${label}`);
		await dom.key(current, 'Escape');
	}
	current = await menu(session, 'File');
	const closeProject = item(session, current, 'Close project');
	assert.equal(closeProject.getAttribute('aria-disabled'), 'false');
	assert.equal(closeProject.querySelector('.context-menu-item-shortcut')?.textContent, 'Ctrl+W');
	await dom.key(current, 'Escape');
	await choose(session, 'Help', 'Check for updates');
	const desktop = await dialog(session, 'Desktop feature');
	await dom.click(button(session, 'Cancel', desktop));
	await dom.wait(() => !desktop.isConnected, 'real desktop notice closes');
	await choose(session, 'File', 'Project properties', ['Project management']);
	await dom.wait(() => !!session.container.querySelector('[data-workspace-panel="metadata"]'), 'actual project properties dock opens');
	assert.deepEqual(session.controller.project, before);
	dom.assertHealthy();
});

test('actual factory reset persists defaults while preserving the current project through a fresh root', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	const before = structuredClone(session.controller.project);
	// The native Appearance carousel needs layout/ResizeObserver. Seed this state through
	// the actual product command; its native radio/carousel witness remains in Playwright.
	await dom.react.act(async () => { await session.controller.actions.preferences.update({ appearance: { theme: 'dark' } }); });
	await dom.wait(() => session.container.querySelector('[data-editor-theme]')?.getAttribute('data-editor-theme') === 'dark', 'actual theme selection publishes');
	assert.equal(record((await preferences(session)).appearance).theme, 'dark');
	await choose(session, 'Help', 'Revert to factory settings');
	const confirmation = await dialog(session, 'Revert to factory settings');
	assert.match(confirmation.textContent ?? '', /Projects and audio files will not be deleted\./u);
	await dom.click(button(session, 'Revert settings', confirmation));
	await dom.wait(() => !confirmation.isConnected, 'actual reset awaits its persisted settings operation');
	assert.equal(dom.element('[data-editor-theme]', session.container).getAttribute('data-editor-theme'), 'system');
	assert.equal(dom.element('[data-workspace-preset]', session.container).getAttribute('data-workspace-preset'), 'modern');
	assert.deepEqual(session.controller.project, before);
	assert.equal(record((await preferences(session)).appearance).theme, 'system');
	await session.reopen();
	assert.deepEqual(session.controller.project, before);
	assert.equal(dom.element('[data-editor-theme]', session.container).getAttribute('data-editor-theme'), 'system');
	assert.equal(record((await preferences(session)).workspace).activeId, 'modern');
	dom.assertHealthy();
});

test('actual generator and playback format menus keep temporal units separate and retain Chirp defaults', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	const before = structuredClone(session.controller.project);
	const initialStatus = session.container.querySelector('[data-status]')?.textContent;
	await dom.click(dom.element('[data-time-display] .timecode__format-button', session.container));
	await dom.wait(() => items(dom.document).some(node => itemLabel(node) === 'seconds'), 'actual temporal format menu opens');
	assert.equal(items(dom.document).some(node => itemLabel(node) === 'Hz'), false);
	await dom.key(dom.element('[role="menu"]'), 'Escape');

	await choose(session, 'Generate', 'Tone');
	const tone = await dialog(session, 'Tone');
	const form = dom.element('form', tone);
	assert.ok(form instanceof dom.window.HTMLFormElement);
	const duration = dom.element('[data-generator-field="durationSeconds"] [data-timecode-direct-entry]', tone);
	assert.ok(duration instanceof dom.window.HTMLInputElement);
	await dom.setValue(duration, '0.01');
	assert.equal(form.checkValidity(), true, 'the real short-duration generator form is valid');
	assert.equal(button(session, 'Generate', tone).disabled, false);
	const durationFormat = button(session, 'Duration (seconds): format', tone);
	assert.equal(button(session, 'Generate', tone).type, 'submit');
	assert.equal(button(session, 'Generate', tone).getAttribute('form'), dom.element('form', tone).id);
	await dom.click(durationFormat);
	assert.equal(tone.isConnected, true);
	assert.equal(button(session, 'Generate', tone).disabled, false, 'format opening does not start generation');
	assert.deepEqual(session.controller.project, before);
	await dom.wait(() => items(dom.document).some(node => itemLabel(node) === 'samples'), 'actual duration format menu opens');
	await dom.click(item(session, dom.document, 'samples'));
	assert.equal(tone.isConnected, true);
	assert.equal(durationFormat.type, 'button', 'format navigation has no native form-submit default');
	assert.equal(button(session, 'Generate', tone).disabled, false, 'format selection does not start generation');
	assert.equal(session.container.querySelector('[data-status]')?.textContent, initialStatus);
	assert.equal(session.container.querySelectorAll('[data-clip-id]').length, 0);
	assert.deepEqual(session.controller.project, before);
	await dom.click(button(session, 'Cancel', tone));
	await choose(session, 'Generate', 'Chirp');
	const chirp = await dialog(session, 'Chirp');
	const waveform = [...chirp.querySelectorAll('button')].find(node => /^Waveform(?::|$)/u.test(node.getAttribute('aria-label') ?? ''));
	assert.ok(waveform instanceof dom.window.HTMLButtonElement);
	assert.equal(waveform.disabled, false);
	const start = dom.element('[data-generator-field="startAmplitude"] input', chirp);
	const end = dom.element('[data-generator-field="endAmplitude"] input', chirp);
	assert.ok(start instanceof dom.window.HTMLInputElement && end instanceof dom.window.HTMLInputElement);
	assert.equal(start.getAttribute('aria-label'), 'Start amplitude (0–1)');
	assert.equal(end.getAttribute('aria-label'), 'End amplitude (0–1)');
	assert.equal(start.value, '0.8'); assert.equal(end.value, '0.8');
	await dom.click(waveform);
	await dom.wait(() => !!dom.document.querySelector('[role="listbox"]'), 'actual waveform options open');
	assert.deepEqual([...dom.document.querySelectorAll('[role="listbox"] [role="option"]')].map(node => node.textContent?.trim()), ['Sine', 'Square', 'Sawtooth']);
	await dom.click(dom.byText('[role="option"]', 'Square'));
	assert.equal(waveform.querySelector('.dropdown__text')?.textContent, 'Square');
	assert.deepEqual(session.controller.project, before);
	dom.assertHealthy();
});

test('actual track flyout actions and global multiview transitions update and preserve the real product project', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	const initial = structuredClone(session.controller.project);
	await dom.click(button(session, 'Add track', session.container));
	await dom.wait(() => !!dom.document.querySelector('.add-track-flyout'), 'actual Add track flyout opens');
	const flyout = dom.element('.add-track-flyout');
	assert.ok(item(session, flyout, 'Audio track')); assert.ok(item(session, flyout, 'Label track'));
	await dom.click(item(session, flyout, 'Audio track'));
	await dom.wait(() => !flyout.isConnected && session.container.querySelectorAll('[data-track-row]').length === 2, 'actual add Audio action completes');
	assert.equal(tracks(session.controller.project).length, 2);
	assert.deepEqual(tracks(session.controller.project).map(track => track.type), ['audio', 'audio']);
	assert.equal(new Set(tracks(session.controller.project).map(track => track.id)).size, 2);
	assert.equal(tracks(initial).length, 1);
	const trackIds = tracks(session.controller.project).map(track => { assert.ok(typeof track.id === 'string'); return track.id; });
	await dom.wait(() => session.container.querySelector('[data-save-state]')?.getAttribute('data-state') === 'saved', 'actual project save settles');
	let persisted: unknown;
	const projectId = record(session.controller.project).id; assert.ok(typeof projectId === 'string');
	await dom.react.act(async () => { persisted = await session.environment.store.loadProject(projectId); });
	assert.deepEqual(record(persisted).tracks, tracks(session.controller.project));
	await dom.click(button(session, 'Spectrogram options', session.container));
	await dom.click(dom.element('[data-action-id="multiview-view"] [role="menuitem"]'));
	await dom.wait(() => [...session.container.querySelectorAll('[data-track-row]')].every(track => track.getAttribute('data-display-mode') === 'multiview'), 'actual global multiview publishes to every audio track');
	assert.equal(button(session, 'Spectrogram', session.container).getAttribute('aria-pressed'), 'false');
	assert.deepEqual(tracks(session.controller.project).map(track => track.displayMode), ['multiview', 'multiview']);
	await dom.click(button(session, 'Spectrogram options', session.container));
	const multiview = dom.element('[data-action-id="multiview-view"] [role="menuitem"]');
	assert.equal(multiview.querySelectorAll('.context-menu-item-checkmark .icon').length, 1);
	await dom.click(multiview);
	await dom.wait(() => [...session.container.querySelectorAll('[data-track-row]')].every(track => track.getAttribute('data-display-mode') === 'waveform'), 'actual global toggle restores waveform');
	assert.deepEqual(tracks(session.controller.project).map(track => track.id), trackIds);
	assert.deepEqual(tracks(session.controller.project).map(track => track.displayMode), ['waveform', 'waveform']);
	dom.assertHealthy();
});
