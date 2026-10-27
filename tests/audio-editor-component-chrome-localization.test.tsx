/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComponentCopyProvider } from '../vendor/audacity-design-system/components/src/contexts/ComponentCopyContext.tsx';
import { NumberStepper } from '../vendor/audacity-design-system/components/src/NumberStepper/NumberStepper.tsx';
import { DialogHeader } from '../vendor/audacity-design-system/components/src/DialogHeader/DialogHeader.tsx';
import { AccessibilityProfileProvider } from '../vendor/audacity-design-system/components/src/contexts/AccessibilityProfileContext.tsx';
import { Toolbar } from '../vendor/audacity-design-system/components/src/Toolbar/Toolbar.tsx';
import { SelectionToolbar } from '../vendor/audacity-design-system/components/src/SelectionToolbar/SelectionToolbar.tsx';
import { componentCopyTemplate } from '../vendor/audacity-design-system/components/src/component-copy.ts';
Object.assign(globalThis, { React });
const copy = { close: 'Schließen', increaseValue: 'Erhöhen', decreaseValue: 'Verringern', toolToolbar: 'Werkzeuge', selection: 'Zeitauswahl', duration: 'Auswahllänge' };
const render = (children: React.ReactNode) => renderToStaticMarkup(<ComponentCopyProvider copy={copy} locale="de"><AccessibilityProfileProvider initialProfileId="au4-tab-groups">{children}</AccessibilityProfileProvider></ComponentCopyProvider>);

test('dialog controls use the application copy in both platform layouts', () => {
	for (const os of ['windows', 'macos'] as const) assert.match(render(<DialogHeader title="Preferences" os={os} onClose={() => undefined} />), /aria-label="Schließen"/u);
});
test('all numeric steppers inherit localized arrows while explicit labels retain priority', () => {
	const html = render(<NumberStepper value="3" />);
	assert.match(html, /aria-label="Erhöhen"/u); assert.match(html, /aria-label="Verringern"/u);
	assert.match(render(<NumberStepper value="3" incrementLabel="Custom" />), /aria-label="Custom"/u);
});
test('toolbar landmark and selection captions use supplied chrome copy', () => {
	assert.match(render(<Toolbar enableTabGroup />), /aria-label="Werkzeuge"/u);
	const html = render(<SelectionToolbar selectionStart={0} selectionEnd={2} />);
	assert.match(html, />Zeitauswahl</u); assert.match(html, />Auswahllänge</u);
});
test('component templates preserve authored dollar and brace text literally', () => {
	assert.equal(componentCopyTemplate('Resize: {title}', { title: '$& {value}' }), 'Resize: $& {value}');
});

test('the editor provider reuses canonical translations for mounted form chrome', async () => {
	const { EditorComponentCopyProvider } = await import('../src/common/editor/ui/EditorComponentCopyProvider.tsx');
	const { default: Shell } = await import('../src/common/editor/ui/AudioEditorDialogShell.tsx');
	const html = renderToStaticMarkup(<EditorComponentCopyProvider copy={{ close: 'Schließen', 'ui.designSystem.resize': 'Größe: {title}' }} locale="de"><Shell title="$& Preferences" onClose={() => undefined}>Content</Shell></EditorComponentCopyProvider>);
	assert.match(html, /aria-label="Schließen"/u);
	assert.match(html, /aria-label="Größe: \$&amp; Preferences"/u);
});

test('manual value portals and reset menus inherit translated numeric copy', async () => {
	const { act } = await import('react');
	const { createRoot } = await import('react-dom/client');
	const { installReactTestDom } = await import('./helpers/react-test-dom.ts');
	const { ManualValueDialog } = await import('../vendor/audacity-design-system/components/src/ManualValueDialog/ManualValueDialog.tsx');
	const { useValueContextMenu } = await import('../vendor/audacity-design-system/components/src/hooks/useValueContextMenu.tsx');
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	let menu: ReturnType<typeof useValueContextMenu> | undefined;
	function View() { menu = useValueContextMenu({ onEnterValue: () => undefined, onReset: () => undefined, resetLabel: '$& 42' }); return <>{menu.menu}<ManualValueDialog isOpen title="Volume" value={2} onApply={() => undefined} onClose={() => undefined} /></>; }
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	try {
		await act(async () => root.render(<ComponentCopyProvider copy={{ value: 'Wert', apply: 'Übernehmen', cancel: 'Abbrechen', enterValue: 'Wert eingeben…', resetValue: 'Zurück auf {value}' }}><View /></ComponentCopyProvider>));
		assert.ok(document.body.textContent?.includes('Wert')); assert.ok(document.body.textContent?.includes('Übernehmen')); assert.ok(document.body.textContent?.includes('Abbrechen'));
		assert.ok(menu);
		await act(async () => menu?.onContextMenu({ preventDefault() {}, stopPropagation() {}, currentTarget: dom.container, clientX: 1, clientY: 1 } as unknown as React.MouseEvent));
		assert.ok(document.body.textContent?.includes('Wert eingeben…')); assert.ok(document.body.textContent?.includes('Zurück auf $& 42'));
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
