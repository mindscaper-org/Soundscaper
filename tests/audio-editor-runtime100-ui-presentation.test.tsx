/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import type { CustomToolbarButtonAction } from '../src/common/editor/ui/toolbar/custom-toolbar-button-actions.ts';
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
	Array.prototype.flat = function<A, D extends number = 1>(this: A, depth?: D): FlatArray<A, D>[] { if (Object.is(this, KEYBOARD_MAP_ROWS)) flats++; return Reflect.apply(original, this, [depth]) as FlatArray<A, D>[]; };
	try {
		await act(async () => root.render(<KeyboardMapDialog commands={[{ id: 'cut', label: 'Cut', categoryId: 'edit', categoryLabel: 'Edit' }]} shortcuts={{ cut: ['Ctrl+X'] }} copy={{}} onClose={() => {}} />));
		const initial = flats; const modifier = dom.one('[data-state="Ctrl"]');
		await act(async () => { reactProps(modifier).onClick(); });
		t.diagnostic(`layout flatten passes initial ${initial}, modifier ${flats - initial}`); assert.equal(flats - initial, 0);
	} finally { Array.prototype.flat = original; await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct; if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore(); }
});
void test('U20 custom action search reuses bounded frozen action text over repeated search edits', t => {
	let reads = 0; const actions = Object.freeze(Array.from({ length: 200 }, (_, i) => { const path = Object.freeze(['Edit', `Action ${i}`]); return new Proxy(Object.freeze({ actionId: `a${i}`, path, label: `Action ${i}`, disabled: false }), { get(target, key, receiver) { if (key === 'path') reads++; return Reflect.get(target, key, receiver) as unknown; } }); }));
	const find = prepareCustomToolbarActionSearch(actions); for (let i = 0; i < 30; i++) assert.equal(find('  Action 199  ')[0]?.actionId, 'a199');
	t.diagnostic(`action path reads ${reads}`); assert.ok(reads <= 400);
	const mutable = [{ actionId: 'x', path: ['Before'], label: 'Before', disabled: false }]; const fresh = prepareCustomToolbarActionSearch(mutable); mutable[0]!.path[0] = 'After'; assert.equal(fresh('After').length, 1);
});
void test('U21 symbol searches reuse bounded normalized glyph names', t => {
	let replacements = 0; const original = String.prototype.replaceAll;
	String.prototype.replaceAll = function(this: string, search: string | RegExp, replacement: string | ((substring: string, ...args: unknown[]) => string)): string { if (String(this).startsWith('SYMBOL_')) replacements++; return Reflect.apply(original, this, [search, replacement]) as string; };
	try { const find = prepareCustomToolbarSymbolSearch(Object.freeze(Array.from({ length: 200 }, (_, i) => `SYMBOL_${i}`))); for (let i = 0; i < 30; i++) assert.deepEqual(find(' symbol_199 '), ['SYMBOL_199']); } finally { String.prototype.replaceAll = original; }
	t.diagnostic(`symbol normalization calls ${replacements}`); assert.equal(replacements, 200);
});
void test('U22 translation option-source presentation shares the current draft reader', t => {
	let reads = 0; const draft = { ...createTranslationDraft(createContributionSnapshot('fr', {}, {})), entries: Object.freeze(Array.from({ length: 200 }, (_, i) => new Proxy(Object.freeze({ key: `k${i}`, source: `Source ${i}`, baselineText: '', baselineEntry: null, translation: 'Text' }), { get(target, key, receiver) { if (key === 'key') reads++; return Reflect.get(target, key, receiver) as unknown; } }))) };
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

void test('prepared dialog search respects mutable, accessor and entry/character capacity fallbacks', () => {
	let path = Object.freeze(['Before']);
	const accessor = Object.freeze({ actionId: 'a', get path() { return path; }, label: 'A', disabled: false });
	const actionReader = prepareCustomToolbarActionSearch(Object.freeze([accessor]));
	path = Object.freeze(['After']); assert.equal(actionReader('After').length, 1);
	const long = 'x'.repeat(4_194_305);
	const oversized = prepareCustomToolbarActionSearch(Object.freeze([Object.freeze({ actionId: 'a', path: Object.freeze([long]), label: 'A', disabled: false })]));
	assert.equal(oversized('xxx').length, 1);
	const symbols = Object.freeze(Array.from({ length: 16_385 }, (_, i) => `SYMBOL_${i}`));
	assert.deepEqual(prepareCustomToolbarSymbolSearch(symbols)('symbol_16384'), ['SYMBOL_16384']);
	const draft = { ...createTranslationDraft(createContributionSnapshot('fr', {}, {})), entries: [{ key: 'before', source: 'A', baselineText: '', baselineEntry: null, translation: 'B' }] };
	const read = createCommunityTranslationDraftReader(draft); draft.entries = [{ key: 'after', source: 'C', baselineText: '', baselineEntry: null, translation: 'D' }];
	assert.equal(read('before'), undefined); assert.equal(read('after')?.source, 'C');
});
void test('retired dialog search and binding projections do not keep source inventories alive', async () => {
	assert.ok(globalThis.gc);
	function retired() {
		const action = Object.freeze({ actionId: 'a', path: Object.freeze(['Edit']), label: 'A', disabled: false });
		const actions = Object.freeze([action]); prepareCustomToolbarActionSearch(actions)('edit');
		const entry = Object.freeze({ key: 'k', source: 'S', baselineText: '', baselineEntry: null, translation: 'T' });
		const draft = Object.freeze({ ...createTranslationDraft(createContributionSnapshot('fr', {}, {})), entries: Object.freeze([entry]) });
		createCommunityTranslationDraftReader(draft)('k');
		const binding = { id: 'b', key: 'K', state: 'plain', context: 'edit', contextLabel: 'Edit', action: 'A', text: 'K' };
		createKeyboardMapBindingView([binding]).at('K', 'plain');
		return [new WeakRef(actions), new WeakRef(action), new WeakRef(draft), new WeakRef(entry), new WeakRef(binding)];
	}
	const references = retired();
	for (let i = 0; i < 8; i++) { await new Promise<void>(resolve => setImmediate(resolve)); globalThis.gc(); }
	for (const reference of references) assert.equal(reference.deref(), undefined);
});
void test('noncanonical frozen dialog inventories retain native lookup and fresh string coercion', () => {
	const entry = Object.freeze({ key: 'first', source: 'S', baselineText: '', baselineEntry: null, translation: 'T' });
	const other = Object.freeze({ key: 'iterator-only', source: 'X', baselineText: '', baselineEntry: null, translation: 'Y' });
	const entries = [entry]; Object.defineProperty(entries, Symbol.iterator, { value: function* () { yield other; } }); Object.freeze(entries);
	const draft = Object.freeze({ ...createTranslationDraft(createContributionSnapshot('fr', {}, {})), entries });
	assert.equal(createCommunityTranslationDraftReader(draft)('first'), entry);
});
void test('frozen dialog action IDs with mutable string coercion retain fresh search text', () => {
	let actionName = 'before';
	const actionId = { toString() { return actionName; } };
	const find = prepareCustomToolbarActionSearch(Object.freeze([Object.freeze({ actionId, path: Object.freeze(['Edit']), label: 'A', disabled: false })]) as never);
	actionName = 'after'; assert.equal(find('after').length, 1);
});

void test('search preparation leaves sparse frozen arrays and invalid rows to their native query behavior', () => {
	const action = Object.freeze({ actionId: 'a', path: Object.freeze(['Edit']), label: 'A', disabled: false });
	const actions = new Array<CustomToolbarButtonAction>(2); actions[1] = action; Object.freeze(actions);
	const symbols = new Array<string>(2); symbols[1] = 'SYMBOL_A'; Object.freeze(symbols);
	assert.deepEqual(prepareCustomToolbarActionSearch(actions)('edit'), [action]);
	assert.deepEqual(prepareCustomToolbarSymbolSearch(symbols)('symbol a'), ['SYMBOL_A']);
	const invalidActions = Object.freeze([undefined, null]) as unknown as readonly CustomToolbarButtonAction[];
	const invalidSymbols = Object.freeze([undefined, 2]) as unknown as readonly string[];
	const readActions = prepareCustomToolbarActionSearch(invalidActions), readSymbols = prepareCustomToolbarSymbolSearch(invalidSymbols);
	assert.throws(() => readActions(''), TypeError); assert.throws(() => readSymbols(''), TypeError);
});
void test('search preparation reads no frozen accessor slots and queries their current values', () => {
	let actionReads = 0, symbolReads = 0;
	let action = Object.freeze({ actionId: 'a', path: Object.freeze(['Before']), label: 'A', disabled: false });
	let symbol = 'BEFORE';
	const actions: CustomToolbarButtonAction[] = []; Object.defineProperty(actions, 0, { enumerable: true, get() { actionReads++; return action; } }); Object.freeze(actions);
	const symbols: string[] = []; Object.defineProperty(symbols, 0, { enumerable: true, get() { symbolReads++; return symbol; } }); Object.freeze(symbols);
	const readActions = prepareCustomToolbarActionSearch(actions), readSymbols = prepareCustomToolbarSymbolSearch(symbols);
	assert.equal(actionReads, 0); assert.equal(symbolReads, 0);
	action = Object.freeze({ actionId: 'a', path: Object.freeze(['After']), label: 'A', disabled: false }); symbol = 'AFTER';
	assert.deepEqual(readActions('after'), [action]); assert.deepEqual(readSymbols('after'), ['AFTER']);
	assert.equal(actionReads, 1); assert.equal(symbolReads, 1);
});
void test('search preparation ignores custom iterators and preserves own filter callbacks at query time', () => {
	const action = Object.freeze({ actionId: 'a', path: Object.freeze(['Edit']), label: 'A', disabled: false });
	const actions = [action], symbols = ['SYMBOL_A'];
	const iterator = () => { throw new Error('The native filter never consumes this iterator.'); };
	Object.defineProperty(actions, Symbol.iterator, { value: iterator }); Object.freeze(actions);
	Object.defineProperty(symbols, Symbol.iterator, { value: iterator }); Object.freeze(symbols);
	assert.deepEqual(prepareCustomToolbarActionSearch(actions)('edit'), [action]);
	assert.deepEqual(prepareCustomToolbarSymbolSearch(symbols)('symbol a'), ['SYMBOL_A']);
	let actionFilters = 0, symbolFilters = 0;
	const filteredActions = [action], filteredSymbols = ['SYMBOL_A'];
	Object.defineProperty(filteredActions, 'filter', { value: () => { actionFilters++; return []; } }); Object.freeze(filteredActions);
	Object.defineProperty(filteredSymbols, 'filter', { value: () => { symbolFilters++; return []; } }); Object.freeze(filteredSymbols);
	const readActions = prepareCustomToolbarActionSearch(filteredActions), readSymbols = prepareCustomToolbarSymbolSearch(filteredSymbols);
	assert.equal(actionFilters, 0); assert.equal(symbolFilters, 0);
	assert.deepEqual(readActions('edit'), []); assert.deepEqual(readSymbols('symbol a'), []);
	assert.equal(actionFilters, 1); assert.equal(symbolFilters, 1);
});
void test('search preparation skips oversized raw strings before normalization and keeps fresh query scoring', () => {
	const large = 'A'.repeat(4_194_305); let largeNormalizations = 0;
	const original = String.prototype.toLowerCase;
	String.prototype.toLowerCase = function(this: string) { if (this.length > 4_194_304) largeNormalizations++; return original.call(this); };
	try {
		const readActions = prepareCustomToolbarActionSearch(Object.freeze([Object.freeze({ actionId: 'a', path: Object.freeze([large]), label: 'A', disabled: false })]));
		const readSymbols = prepareCustomToolbarSymbolSearch(Object.freeze([large]));
		assert.equal(largeNormalizations, 0);
		assert.equal(readActions('aaa').length, 1); assert.equal(readSymbols('aaa').length, 1);
		assert.equal(largeNormalizations, 2);
	} finally { String.prototype.toLowerCase = original; }
});
