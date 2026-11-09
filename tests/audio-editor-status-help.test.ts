/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { editorStatusHelp, statusHelpTransportCue } from '../src/common/editor/ui/editor-status-help.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { iconNameToChar } from '../src/common/editor/audacity-iconcodes.js';

test('unnamed button labels omit private-use icons while retaining ordinary Unicode text', () => {
	const dom = installReactTestDom();
	try {
		const root = dom.container as unknown as HTMLElement;
		const button = document.createElement('button');
		button.textContent = `${iconNameToChar('PLAY')}Play ♭${String.fromCodePoint(0xf0000)}`;
		root.appendChild(button);
		assert.equal(editorStatusHelp(button, root, ENGLISH_COPY, []), 'Play ♭');
	} finally { dom.restore(); }
});

test('status help uses localized control names and only their current configured shortcut', () => {
	const dom = installReactTestDom();
	try {
		const button = document.createElement('button');
		button.setAttribute('aria-label', 'Rückgängig');
		const icon = document.createElement('span');
		button.appendChild(icon);
		(dom.container as unknown as HTMLElement).appendChild(button);
		const root = dom.container as unknown as HTMLElement;
		const copy = { ...ENGLISH_COPY, undo: 'Rückgängig' };
		assert.equal(editorStatusHelp(icon, root, copy, [{ id: 'undo', label: 'Rückgängig', shortcut: 'Ctrl+Alt+U' }]), 'Rückgängig (Ctrl+Alt+U)');
		assert.equal(editorStatusHelp(icon, root, copy, [{ id: 'undo', label: 'Rückgängig' }]), 'Rückgängig');
		assert.equal(editorStatusHelp(button, document.createElement('div'), copy, []), null);
	} finally { dom.restore(); }
});

test('status help reads live slider values and restores surface instructions away from controls', () => {
	const dom = installReactTestDom();
	try {
		const root = dom.container as unknown as HTMLElement;
		const slider = document.createElement('input');
		slider.setAttribute('type', 'range');
		slider.setAttribute('aria-label', 'Volume');
		slider.setAttribute('aria-valuetext', '−8.0 dB');
		root.appendChild(slider);
		assert.equal(editorStatusHelp(slider, root, ENGLISH_COPY, []), 'Volume: −8.0 dB');
		slider.setAttribute('aria-valuetext', '−2.0 dB');
		assert.equal(editorStatusHelp(slider, root, ENGLISH_COPY, []), 'Volume: −2.0 dB');
		const ruler = document.createElement('canvas');
		ruler.setAttribute('class', 'timeline-ruler');
		root.appendChild(ruler);
		assert.equal(editorStatusHelp(ruler, root, ENGLISH_COPY, []), ENGLISH_COPY.statusHelpRuler);
		root.setAttribute('data-selection-pointer-edge', 'start');
		assert.equal(editorStatusHelp(ruler, root, ENGLISH_COPY, []), ENGLISH_COPY.statusHelpSelectionStart);
	} finally { dom.restore(); }
});

test('transport cues show playback state and speed once, and recording takes precedence', () => {
	assert.equal(statusHelpTransportCue('stopped', 1, false, ENGLISH_COPY, 'en'), 'Stopped');
	assert.equal(statusHelpTransportCue('playing', 1.1, false, ENGLISH_COPY, 'en'), 'Playing · 110%');
	assert.equal(statusHelpTransportCue('paused', 0.75, false, ENGLISH_COPY, 'en'), 'Paused · 75%');
	assert.equal(statusHelpTransportCue('playing', 1.8, true, ENGLISH_COPY, 'en'), 'Recording');
});
