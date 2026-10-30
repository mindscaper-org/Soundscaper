/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { focusOpenedWorkspacePanel } from '../src/common/editor/ui/workspace/workspace-panel-opening-focus.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('opening a panel focuses its root when no child has taken focus', () => {
	const dom = installReactTestDom();
	try {
		const panel = dom.container.ownerDocument.createElement('section');
		dom.container.appendChild(panel);
		focusOpenedWorkspacePanel(panel as unknown as HTMLElement);
		assert.equal(dom.container.ownerDocument.activeElement, panel);
		assert.equal((panel as unknown as HTMLElement).tabIndex, -1);
		focusOpenedWorkspacePanel(null);
		assert.equal(dom.container.ownerDocument.activeElement, panel);
	} finally {
		dom.restore();
	}
});

test('opening a panel preserves focus already handed to its upload summary', () => {
	const dom = installReactTestDom();
	try {
		const panel = dom.container.ownerDocument.createElement('section');
		const uploads = dom.container.ownerDocument.createElement('details');
		const summary = dom.container.ownerDocument.createElement('summary');
		dom.container.appendChild(panel);
		panel.appendChild(uploads);
		uploads.appendChild(summary);
		summary.focus();
		focusOpenedWorkspacePanel(panel as unknown as HTMLElement);
		assert.equal(dom.container.ownerDocument.activeElement, summary);
	} finally {
		dom.restore();
	}
});

for (const target of ['drawer-toggle', 'other-toggle', 'panel-field', 'workspace-control'] as const) {
	test(`opening a panel after closing its menu drawer respects ${target} focus`, () => {
		const dom = installReactTestDom();
		try {
			const owner = dom.container.ownerDocument;
			const drawer = owner.createElement('div');
			drawer.setAttribute('class', 'kw-audio-editor__chrome-drawer-panel');
			drawer.setAttribute('id', 'menu-drawer');
			const opener = owner.createElement('button');
			drawer.appendChild(opener);
			const panel = owner.createElement('section');
			const field = owner.createElement('input');
			panel.appendChild(field);
			const toggle = owner.createElement('button');
			toggle.setAttribute('data-chrome-drawer-toggle', '');
			toggle.setAttribute('aria-controls', target === 'other-toggle' ? 'other-drawer' : 'menu-drawer');
			const control = owner.createElement('button');
			for (const element of [drawer, panel, toggle, control]) dom.container.appendChild(element);
			opener.focus();
			const openingFocus = document.activeElement;
			const next = target === 'panel-field' ? field : target === 'workspace-control' ? control : toggle;
			next.focus();

			focusOpenedWorkspacePanel(panel as unknown as HTMLElement, openingFocus);

			assert.equal(owner.activeElement === (target === 'drawer-toggle' ? panel : next), true);
		} finally {
			dom.restore();
		}
	});
}
