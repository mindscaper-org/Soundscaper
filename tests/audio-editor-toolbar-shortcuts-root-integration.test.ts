/* SPDX-License-Identifier: AGPL-3.0-only */
// Real DOM/controller integration; native pixels, trusted input and browser storage stay in Playwright.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorRootSession, choosePreference, labeledInput } from './helpers/editor-root-session.ts';

type Session = Awaited<ReturnType<typeof createEditorRootSession>>;
const UNDO = 'action://trackedit/undo';
const REDO = 'action://trackedit/redo';

function object(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

function button(session: Session, label: string, root: ParentNode = session.dom.document): HTMLButtonElement {
	const result = [...root.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label
		|| node.textContent?.trim() === label);
	assert.ok(result instanceof session.dom.window.HTMLButtonElement, `Missing real button: ${label}`);
	return result;
}

async function customization(session: Session): Promise<HTMLElement> {
	await session.dom.click(button(session, 'Customize toolbar', session.container));
	await session.dom.wait(() => !!session.dom.document.querySelector('[role="dialog"][aria-label="Customize toolbar"]'),
		'the actual toolbar customization opens');
	return session.dom.element('[role="dialog"][aria-label="Customize toolbar"]');
}

async function editor(session: Session, name?: string): Promise<HTMLElement> {
	const menu = await customization(session);
	const entry = name
		? session.dom.element(`[role="menuitem"][aria-label="Edit ${name}"]`, menu)
		: session.dom.element('[role="menu"][aria-label="Custom button"] [role="menuitem"]', menu);
	await session.dom.click(entry);
	await session.dom.wait(() => !!session.dom.document.querySelector('[role="dialog"][aria-label="Custom button"]'),
		'the actual customization entry opens its editor');
	assert.equal(menu.isConnected, false);
	return session.dom.element('[role="dialog"][aria-label="Custom button"]');
}

async function configure(session: Session, dialog: HTMLElement, name: string, action: string, icon = 'CUT'): Promise<void> {
	const { dom } = session;
	await dom.setValue(labeledInput(dom, 'Name', dialog), name);
	await dom.setValue(labeledInput(dom, 'Search actions', dialog), action);
	const choices = [...dialog.querySelectorAll('[role="option"]')];
	assert.equal(choices.length, 1, 'the original action URI identifies exactly one real product action');
	const choice = choices[0];
	assert.ok(choice instanceof dom.window.HTMLElement);
	await dom.click(choice);
	await dom.setValue(labeledInput(dom, 'Search symbols', dialog), icon);
	await dom.click(button(session, icon, dialog));
}

async function save(session: Session, dialog: HTMLElement): Promise<void> {
	const control = session.dom.byText('button', 'Save', dialog);
	assert.equal(control.hasAttribute('disabled'), false);
	await session.dom.click(control);
	await session.dom.wait(() => !dialog.isConnected, 'the actual form closes only after its preference write completes');
	session.dom.assertHealthy();
}

async function readPreferences(session: Session): Promise<unknown> {
	let value: unknown;
	await session.dom.react.act(async () => { value = await session.storedPreferences(); });
	return value;
}

async function storedWorkspace(session: Session): Promise<Record<string, unknown>> {
	return object(object(await readPreferences(session)).workspace);
}

async function storedButtons(session: Session): Promise<Record<string, unknown>[]> {
	const value = (await storedWorkspace(session)).customButtons;
	assert.ok(Array.isArray(value));
	return value.map(object);
}

function assertToolbarAbsent(session: Session, name: string): void {
	assert.equal([...session.container.querySelectorAll('.kw-audio-editor__custom-toolbar-button')]
		.some(node => node.getAttribute('aria-label') === name), false);
}

test('actual toolbar symbol choices preserve literal glyphs and their persisted identity across a fresh root', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	const initialProject = structuredClone(session.controller.project);
	let dialog = await editor(session);
	assert.equal(button(session, 'VIDEO', dialog).textContent, '\uF4C2');
	assert.equal(button(session, 'PAGE_LOCK', dialog).textContent, '\uF4C3');
	assert.equal(dialog.querySelector('button[aria-label="NONE"]') === null, true);
	await configure(session, dialog, 'Monitor undo', UNDO, 'DESKTOP_MONITOR');
	assert.equal(button(session, 'DESKTOP_MONITOR', dialog).textContent, '\uF35E');
	await save(session, dialog);
	assert.equal(button(session, 'Monitor undo', session.container).textContent, '\uF35E');
	const [stored] = await storedButtons(session);
	assert.ok(stored);
	assert.ok(typeof stored.id === 'string');
	assert.match(stored.id, /^custom-/u);
	assert.deepEqual(stored, { id: stored.id, name: 'Monitor undo', icon: 'DESKTOP_MONITOR', actionId: UNDO });
	await session.reopen();
	assert.equal(button(session, 'Monitor undo', session.container).textContent, '\uF35E');
	assert.deepEqual(await storedButtons(session), [stored]);
	dialog = await editor(session, 'Monitor undo');
	assert.equal(button(session, 'DESKTOP_MONITOR', dialog).getAttribute('aria-pressed'), 'true');
	await dom.setValue(labeledInput(dom, 'Search symbols', dialog), 'graduation cap');
	await dom.click(button(session, 'GRADUATION_CAP', dialog));
	assert.equal(button(session, 'GRADUATION_CAP', dialog).textContent, '\uEF74');
	await save(session, dialog);
	assert.equal(button(session, 'Monitor undo', session.container).textContent, '\uEF74');
	assert.deepEqual(await storedButtons(session), [{ id: stored.id, name: 'Monitor undo', icon: 'GRADUATION_CAP', actionId: UNDO }]);
	assert.deepEqual(session.controller.project, initialProject);
	dom.assertHealthy();
});

test('actual custom-button drafts reject blank names and Cancel or Escape never publishes them', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	const dialog = await editor(session);
	const before = await readPreferences(session);
	assert.equal(button(session, 'Save', dialog).disabled, true);
	await configure(session, dialog, 'Cancelled custom action', 'delete-leave-gap', 'ACCIACCATURA');
	assert.equal(button(session, 'ACCIACCATURA', dialog).textContent, '\uF427');
	assert.equal(button(session, 'Save', dialog).disabled, false);
	await dom.setValue(labeledInput(dom, 'Name', dialog), '   ');
	assert.equal(button(session, 'Save', dialog).disabled, true);
	await dom.setValue(labeledInput(dom, 'Name', dialog), 'Cancelled custom action');
	await dom.click(button(session, 'Cancel', dialog));
	await dom.wait(() => !dialog.isConnected, 'Cancel closes the real draft');
	assertToolbarAbsent(session, 'Cancelled custom action');
	assert.deepEqual(await readPreferences(session), before);
	const reopened = await editor(session);
	assert.equal(labeledInput(dom, 'Name', reopened).value, '');
	await dom.key(reopened, 'Escape');
	await dom.wait(() => !reopened.isConnected, 'Escape closes the actual empty draft');
	assertToolbarAbsent(session, 'Cancelled custom action');
	assert.deepEqual(await readPreferences(session), before);
	dom.assertHealthy();
});

test('actual custom-button edits, visibility and removal retain exact durable identity through fresh roots', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	let dialog = await editor(session);
	await configure(session, dialog, 'My undo', UNDO);
	await save(session, dialog);
	const [initial] = await storedButtons(session);
	assert.ok(initial);
	assert.ok(typeof initial.id === 'string');
	const buttonId = initial.id;
	assert.match(buttonId, /^custom-/u);
	assert.deepEqual(initial, { id: initial.id, name: 'My undo', icon: 'CUT', actionId: UNDO });
	dialog = await editor(session, 'My undo');
	assert.equal(labeledInput(dom, 'Name', dialog).value, 'My undo');
	assert.match(labeledInput(dom, 'Search actions', dialog).value, /Undo/u);
	await configure(session, dialog, 'My redo', REDO, 'ACCIACCATURA');
	await save(session, dialog);
	assertToolbarAbsent(session, 'My undo');
	assert.equal(button(session, 'My redo', session.container).textContent, '\uF427');
	const expected = { id: initial.id, name: 'My redo', icon: 'ACCIACCATURA', actionId: REDO };
	assert.deepEqual(await storedButtons(session), [expected]);
	let menu = await customization(session);
	const visibility = dom.element('[role="checkbox"][aria-label="My redo"]', menu);
	assert.equal(visibility.getAttribute('aria-checked'), 'true');
	await dom.click(visibility);
	assert.equal(visibility.getAttribute('aria-checked'), 'false');
	assertToolbarAbsent(session, 'My redo');
	await dom.wait(async () => object((await storedWorkspace(session)).toolbarButtons)[buttonId] === false,
		'the actual preference repository persists hidden visibility');
	await session.reopen();
	assertToolbarAbsent(session, 'My redo');
	assert.deepEqual(await storedButtons(session), [expected]);
	menu = await customization(session);
	const hidden = dom.element('[role="checkbox"][aria-label="My redo"]', menu);
	assert.equal(hidden.getAttribute('aria-checked'), 'false');
	await dom.click(hidden);
	await dom.key(menu, 'Escape');
	await dom.wait(() => !menu.isConnected, 'the real customization menu closes');
	assert.equal(button(session, 'My redo', session.container).textContent, '\uF427');
	dialog = await editor(session, 'My redo');
	assert.match(labeledInput(dom, 'Search actions', dialog).value, /Redo/u);
	await dom.click(button(session, 'Remove button', dialog));
	await dom.wait(() => !dialog.isConnected, 'the real Remove action awaits persistence before closing');
	assertToolbarAbsent(session, 'My redo');
	assert.deepEqual(await storedButtons(session), []);
	await session.reopen();
	menu = await customization(session);
	assert.equal(menu.querySelector('[role="checkbox"][aria-label="My redo"]') === null, true);
	assert.equal(menu.querySelector('[role="menuitem"][aria-label="Edit My redo"]') === null, true);
	assert.deepEqual(await storedButtons(session), []);
	dom.assertHealthy();
});

test('actual duplicate-action custom buttons keep distinct ids when the first is removed', async context => {
	const session = await createEditorRootSession(context);
	for (const name of ['First custom undo', 'Second custom undo']) {
		const dialog = await editor(session);
		await configure(session, dialog, name, UNDO);
		await save(session, dialog);
	}
	assert.equal(button(session, 'First custom undo', session.container).isConnected, true);
	assert.equal(button(session, 'Second custom undo', session.container).isConnected, true);
	const [first, second] = await storedButtons(session);
	assert.ok(first && second);
	assert.ok(typeof first.id === 'string' && typeof second.id === 'string');
	assert.notEqual(first.id, second.id);
	assert.deepEqual(first, { id: first.id, name: 'First custom undo', icon: 'CUT', actionId: UNDO });
	assert.deepEqual(second, { id: second.id, name: 'Second custom undo', icon: 'CUT', actionId: UNDO });
	const dialog = await editor(session, 'First custom undo');
	await session.dom.click(button(session, 'Remove button', dialog));
	await session.dom.wait(() => !dialog.isConnected, 'the first actual custom button is removed');
	assertToolbarAbsent(session, 'First custom undo');
	assert.equal(button(session, 'Second custom undo', session.container).isConnected, true);
	assert.deepEqual(await storedButtons(session), [second]);
	session.dom.assertHealthy();
});

test('actual shortcut preferences sort the full product inventory and omit nonassignable commands', async context => {
	const session = await createEditorRootSession(context);
	const { dom } = session;
	const preferences = await session.preferences();
	await dom.click(dom.byText('[role="tab"]', /Keyboard shortcuts$/u, preferences));
	const groups = preferences.querySelectorAll('[data-shortcut-group]');
	assert.ok(groups.length > 0);
	assert.equal(groups[0]?.getAttribute('data-shortcut-group'), 'menu:file');
	assert.equal(groups[0]?.textContent, 'File');
	assert.equal(preferences.querySelector('[data-shortcut-action]')?.getAttribute('data-shortcut-action'), 'file-new');
	for (const action of ['snap-1-128', 'about-audacity']) {
		assert.equal(preferences.querySelector(`[data-shortcut-action="${action}"]`) === null, true, action);
	}
	assert.equal(preferences.querySelector('[data-shortcut-action*="%1"]') === null, true);
	assert.equal(preferences.querySelectorAll('[data-shortcut-action="snap-enabled"]').length, 1);
	await choosePreference(dom, dom.element('[role="group"][aria-label="Sort commands"]', preferences), 'Alphabetical');
	assert.equal(preferences.querySelectorAll('[data-shortcut-group]').length, 0);
	const labels = [...preferences.querySelectorAll('[data-shortcut-action] [role="group"]')]
		.map(node => node.getAttribute('aria-label'));
	assert.ok(labels.length > 0);
	assert.ok(labels.every((value): value is string => typeof value === 'string'));
	assert.deepEqual(labels, [...labels].sort((left, right) => left.localeCompare(right, 'en')));
	assert.equal(preferences.querySelector('[data-shortcut-action="about-audacity"]') === null, true);
	dom.assertHealthy();
});
