/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { CustomToolbarButtonGroup } from '../src/common/editor/ui/toolbar/CustomToolbarButtons.tsx';
import { createKeyboardMapBindingView } from '../src/common/editor/ui/dialogs/keyboard-map-view.ts';
import { KEYBOARD_MAP_ROWS, type KeyboardMapBinding } from '../src/common/editor/ui/dialogs/keyboard-map-model.ts';
import KeyboardMapDialog from '../src/common/editor/ui/dialogs/KeyboardMapDialog.tsx';
import { prepareCustomToolbarActionSearch, prepareCustomToolbarSymbolSearch } from '../src/common/editor/ui/dialogs/custom-toolbar-button-search.ts';
import { createCommunityTranslationDraftReader } from '../src/common/editor/ui/community-translations/community-translation-message-filter.ts';
import { createTranslationDraft, createContributionSnapshot } from '../src/common/i18n/community-translations.ts';
import AudacityDynamicsEffectLayout from '../src/common/editor/ui/AudacityDynamicsEffectLayout.jsx';
import { createAdmBedAssignmentReader } from '../src/common/editor/ui/adm-bed-assignment-reader.ts';

void test('U17 custom toolbar rendering resolves action identities once for the whole button group', t => {
	let reads = 0;
	const actions = Array.from({ length: 200 }, (_, i) => ({ get actionId() { reads++; return `a${i}`; }, label: 'Action', path: ['Edit'], disabled: false, onClick() {} }));
	const buttons = Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, name: 'Button', icon: 'CUT', actionId: 'a199' }));
	const tree = CustomToolbarButtonGroup({ buttons, actions, copy: {}, run: operation => operation() });
	assert.ok(tree); t.diagnostic(`action ID reads ${reads}`); assert.ok(reads <= 200);
	assert.equal(CustomToolbarButtonGroup({ buttons: [], actions, copy: {}, run: operation => operation() }), null);
});
void test('U18 keyboard-map keys and context detail use one current visible binding projection', t => {
	let reads = 0;
	const bindings = Array.from({ length: 200 }, (_, i): KeyboardMapBinding => ({ id: `b${i}`, get key() { reads++; return `K${i}`; }, state: 'plain', context: 'edit', contextLabel: 'Edit', action: `A${i}`, text: `K${i}` }));
	const view = createKeyboardMapBindingView(bindings);
	for (let i = 0; i < 100; i++) { assert.equal(view.at(`K${i}`, 'plain')[0]?.id, `b${i}`); assert.equal(view.has(`K${i}`), true); assert.equal(view.inContext(`K${i}`, 'edit').length, 1); }
	t.diagnostic(`binding key reads ${reads}`); assert.ok(reads <= 400);
});
void test('U19 keyboard-map modifier changes reuse the owned extra-key rows', async t => {
	const dom = installReactTestDom(); const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	let flats = 0; const original = Array.prototype.flat;
	Array.prototype.flat = function(this: unknown[], depth?: number): unknown[] { if (this === KEYBOARD_MAP_ROWS) flats++; return original.call(this, depth) as unknown[]; };
	try {
		await act(async () => root.render(<KeyboardMapDialog commands={[{ id: 'cut', label: 'Cut', categoryId: 'edit', categoryLabel: 'Edit' }]} shortcuts={{ cut: ['Ctrl+X'] }} copy={{}} onClose={() => {}} />));
		const initial = flats; const modifier = dom.one('[data-state="Ctrl"]');
		await act(async () => { reactProps(modifier).onClick(); });
		t.diagnostic(`layout flatten passes initial ${initial}, modifier ${flats - initial}`); assert.equal(flats - initial, 0);
	} finally { Array.prototype.flat = original; await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct; if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore(); }
});
void test('U20 custom action search reuses bounded frozen action text over repeated search edits', t => {
	let reads = 0; const actions = Object.freeze(Array.from({ length: 200 }, (_, i) => { const path = Object.freeze(['Edit', `Action ${i}`]); return Object.freeze({ actionId: `a${i}`, get path() { reads++; return path; }, label: `Action ${i}`, disabled: false }); }));
	const find = prepareCustomToolbarActionSearch(actions); for (let i = 0; i < 30; i++) assert.equal(find('  Action 199  ')[0]?.actionId, 'a199');
	t.diagnostic(`action path reads ${reads}`); assert.ok(reads <= 400);
	const mutable = [{ actionId: 'x', path: ['Before'], label: 'Before', disabled: false }]; const fresh = prepareCustomToolbarActionSearch(mutable); mutable[0]!.path[0] = 'After'; assert.equal(fresh('After').length, 1);
});
void test('U21 symbol searches reuse bounded normalized glyph names', t => {
	let replacements = 0; const original = String.prototype.replaceAll;
	String.prototype.replaceAll = function(this: string, ...args: Parameters<typeof original>): string { if (String(this).startsWith('SYMBOL_')) replacements++; return original.apply(this, args); };
	try { const find = prepareCustomToolbarSymbolSearch(Object.freeze(Array.from({ length: 200 }, (_, i) => `SYMBOL_${i}`))); for (let i = 0; i < 30; i++) assert.deepEqual(find(' symbol_199 '), ['SYMBOL_199']); } finally { String.prototype.replaceAll = original; }
	t.diagnostic(`symbol normalization calls ${replacements}`); assert.equal(replacements, 200);
});
void test('U22 translation option-source presentation shares the current draft reader', t => {
	let reads = 0; const draft = { ...createTranslationDraft(createContributionSnapshot('fr', {}, {})), entries: Object.freeze(Array.from({ length: 200 }, (_, i) => Object.freeze({ get key() { reads++; return `k${i}`; }, source: `Source ${i}`, translation: 'Text' }))) };
	const read = createCommunityTranslationDraftReader(draft); for (let i = 0; i < 200; i++) assert.equal(read(`k${i}`)?.source, `Source ${i}`);
	t.diagnostic(`draft option key reads ${reads}`); assert.ok(reads <= 400);
});
void test('U25 dynamics parameter presentation uses constant-time parameter membership', t => {
	let reads = 0; const original = Array.prototype.includes; Array.prototype.includes = function(this: unknown[], search: unknown, from?: number): boolean { if (this.length > 100 && this[0] === 'lowCrossover') reads += this.length; return original.call(this, search, from); };
	const names = ['lowCrossover', 'highCrossover', 'attack', 'release', 'lowThreshold', 'lowRatio', 'lowGain', 'midThreshold', 'midRatio', 'midGain', 'highThreshold', 'highRatio', 'highGain', ...Array.from({ length: 200 }, (_, i) => `p${i}`)];
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try { const markup = renderToStaticMarkup(<AudacityDynamicsEffectLayout effectType="multiband-compressor" definition={{ params: Object.fromEntries(names.map(name => [name, {}])) }} renderParameter={(name: string) => <span>{name}</span>} copy={{}} />); assert.match(markup, /data-audacity-parameter="p199"/u); } finally { Array.prototype.includes = original; if (prior) Object.defineProperty(globalThis, 'React', prior); else Reflect.deleteProperty(globalThis, 'React'); }
	t.diagnostic(`parameter list membership work ${reads}`); assert.equal(reads, 0);
});
void test('U26 ADM bed rows share assignment lookup and preserve first duplicate authority', t => {
	let reads = 0; const assignments = Array.from({ length: 200 }, (_, i) => ({ stripKind: 'track' as const, get stripId() { reads++; return `t${i}`; }, sourceChannel: 0, bedChannel: 'L' as const, gain: 0.5 }));
	const read = createAdmBedAssignmentReader(assignments); for (let i = 0; i < 200; i++) assert.equal(read({ stripKind: 'track', stripId: `t${i}`, sourceChannel: 0 })?.gain, 0.5);
	t.diagnostic(`assignment strip ID reads ${reads}`); assert.ok(reads <= 400);
	assert.equal(createAdmBedAssignmentReader([{ ...assignments[0]!, gain: 0.2 }, { ...assignments[0]!, gain: 0.8 }])({ stripKind: 'track', stripId: 't0', sourceChannel: 0 })?.gain, 0.2);
});
