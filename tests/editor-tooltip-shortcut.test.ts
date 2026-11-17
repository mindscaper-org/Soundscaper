/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorTooltipShortcutResolver } from '../src/common/editor/ui/editor-tooltip-shortcut.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const menus = [{ id: 'edit', items: [
	{ id: 'undo', label: 'Undo recording', shortcut: 'Ctrl+Z' },
	{ id: 'zoom-fit', label: 'Fit project', shortcut: 'Ctrl+F' },
	{ id: 'preferences', label: 'Preferences…', shortcut: 'Ctrl+P' },
] }];

test('tooltip bindings follow canonical IDs, localized menu labels and all saved assignments', () => {
	const resolve = createEditorTooltipShortcutResolver(menus, {
		'action://trackedit/undo': ['Ctrl+Z', 'Alt+Backspace'],
		'zoom-to-fit-project': ['Ctrl+F'], 'preference-dialog': ['Ctrl+P'],
	});
	assert.equal(resolve('Undo', 'undo'), 'Ctrl+Z, Alt+Backspace');
	assert.equal(resolve('Undo recording'), 'Ctrl+Z, Alt+Backspace');
	assert.equal(resolve('Fit project'), 'Ctrl+F');
	assert.equal(resolve('Preferences'), 'Ctrl+P');
	assert.equal(resolve('Unrelated'), '');
});

test('unassigned keys and explicit command identities never fall back to another command', () => {
	const resolve = createEditorTooltipShortcutResolver(menus, {
		'zoom-to-fit-project': [], 'preference-dialog': ['Ctrl+P'],
	});
	assert.equal(resolve('Fit project'), '');
	assert.equal(resolve('Preferences', 'zoom-fit'), '');
	const ambiguous = createEditorTooltipShortcutResolver([
		{ id: 'one', label: 'Open', shortcut: 'F3' }, { id: 'two', label: 'Open', shortcut: 'F4' },
	], {});
	assert.equal(ambiguous('Open'), '');
	assert.equal(ambiguous('Open', 'two'), 'F4');
});

test('assigned commands outside menus use translated inventory labels and pause shares Play', () => {
	const resolve = createEditorTooltipShortcutResolver([], {
		'action://playback/play': ['P', 'Space'], 'split-tool': ['S'],
	}, { audacityParityLabelSplitTool: 'Werkzeug zum Teilen' });
	assert.equal(resolve('Pause', 'action://playback/pause'), 'P, Space');
	assert.equal(resolve('Pause recording', 'action://record/pause'), 'P, Space');
	assert.equal(resolve('Werkzeug zum Teilen'), 'S');
});

test('tooltip targets honor action metadata and local aria shortcuts without inheriting flyout actions', () => {
	const dom = installReactTestDom();
	const resolve = createEditorTooltipShortcutResolver([], {
		'action://playback/play': ['P'], 'record-on-current-track': ['R'], 'action://cut': ['Ctrl+X'],
		'action://record/stop': ['Alt+R'],
	}, { pauseRecording: 'Pause recording', stopRecording: 'Stop recording' });
	try {
		const transport = document.createElement('span');
		transport.setAttribute('data-transport', 'play');
		const play = document.createElement('button');
		transport.appendChild(play);
		document.body.appendChild(transport);
		assert.equal(resolve('Play at speed', '', play), 'P');
		const flyout = document.createElement('div');
		flyout.setAttribute('role', 'menu');
		transport.appendChild(flyout);
		const close = document.createElement('button');
		flyout.appendChild(close);
		assert.equal(resolve('Close', '', close), '');
		const cut = document.createElement('span');
		cut.setAttribute('data-edit', 'cut');
		cut.appendChild(close);
		assert.equal(resolve('Cut', '', close), 'Ctrl+X');
		close.setAttribute('aria-keyshortcuts', 'Control+Shift+C');
		assert.equal(resolve('Copy curve', '', close), 'Control+Shift+C');
		transport.setAttribute('data-transport', 'record');
		assert.equal(resolve('Pause recording', '', play), 'P');
		assert.equal(resolve('Stop recording', '', play), 'Alt+R');
	} finally { dom.restore(); }
});

test('toolbar and track control labels resolve their actual operation when inventory names differ', () => {
	const dom = installReactTestDom();
	const resolve = createEditorTooltipShortcutResolver([], {
		'action://playback/rewind-start': ['Home'],
		'action://trackedit/global-view-spectrogram': ['Alt+S'],
		'action://trackedit/track-view-spectrogram': ['Alt+T'],
		'clip-gain': ['Alt+G'], 'track-mute': ['Shift+U'], 'track-solo': ['Shift+S'], 'add-realtime-effects': ['E'],
	}, { jumpStart: 'Zum Projektanfang', spectrogramView: 'Spektrogramm', clipGain: 'Clip gain', mute: 'Stumm', solo: 'Solo', effects: 'Effekte' });
	try {
		const toolbar = document.createElement('div');
		toolbar.setAttribute('data-editor-tool-toolbar', '');
		const button = document.createElement('button');
		toolbar.appendChild(button);
		assert.equal(resolve('Zum Projektanfang', '', button), 'Home');
		assert.equal(resolve('Spektrogramm', '', button), 'Alt+S');
		assert.equal(resolve('Clip gain', '', button), '', 'the envelope tool must not show the gain-dialog shortcut');
		const track = document.createElement('div');
		track.setAttribute('data-track-row', '');
		const controls = document.createElement('div');
		controls.setAttribute('class', 'track-control-panel');
		track.appendChild(controls);
		controls.appendChild(button);
		assert.equal(resolve('Stumm', '', button), 'Shift+U');
		assert.equal(resolve('Solo', '', button), 'Shift+S');
		assert.equal(resolve('Effekte', '', button), 'E');
	} finally { dom.restore(); }
});
