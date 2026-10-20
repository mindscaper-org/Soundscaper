/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDACITY_ACTION_ALIASES, AUDACITY_ACTION_MANIFEST, applyAudacityParityToMenus,
	audacityActionDefinition, resolveAudacityActionHandler, resolveAudacityActionId } from '../src/common/editor/audacity-action-parity.js';

const rate = 'action://trackedit/track/change-rate?rate=';
const color = 'action://trackedit/clip/change-color?colorindex=';
const effect = 'action://effects/open?effectId=';

function dynamicRuntime(invoke: (...parameters: unknown[]) => void) {
	return {
		track: { setRate: invoke, setColor: invoke },
		clip: { setColor: invoke },
		effects: { openById: invoke, addRealtimeById: invoke, replaceRealtimeById: invoke },
	};
}

test('exact definitions, aliases and prototype-like unknown IDs retain the pinned matching authority', () => {
	for (const id of Object.keys(AUDACITY_ACTION_MANIFEST)) assert.equal(audacityActionDefinition(id), AUDACITY_ACTION_MANIFEST[resolveAudacityActionId(id)], id);
	for (const [alias, id] of Object.entries(AUDACITY_ACTION_ALIASES)) { assert.ok(typeof id === 'string'); assert.equal(audacityActionDefinition(alias), AUDACITY_ACTION_MANIFEST[id], alias); }
	for (const id of [null, undefined, 0, {}, '', 'constructor', '__proto__', 'toString', 'unknown-action']) {
		assert.equal(audacityActionDefinition(id), null, String(id));
	}
});

test('dynamic decoding and numeric admission preserve exact existing values and invalid-result definitions', () => {
	const cases: Array<readonly [string, boolean, Array<string | number>]> = [
		[`${rate}44100`, true, [44100]], [`${rate}4.41e4`, true, [44100]], [`${rate}%2B44100`, true, [44100]],
		[`${rate}0`, false, []], [`${rate}-1`, false, []], [`${rate}1.5`, false, []], [`${rate}9007199254740992`, false, []], [`${rate}1/extra`, false, []],
		[`${color}0`, true, [0]], [`${color}-0`, true, [-0]], [`${color}+`, true, [0]], [`${color}-1`, false, []],
		[`${effect}hello+world`, true, ['hello world']], [`${effect}hello%2Bworld`, true, ['hello+world']],
		[`${effect}caf%C3%A9%2Ftest%3Fa%3D1`, true, ['café/test?a=1']], [`${effect}%20`, true, [' ']],
		[`${effect}`, false, []], [`${effect}%`, false, []], [`${effect}%E0%A4%A`, false, []],
	];
	for (const [id, valid, parameters] of cases) {
		assert.ok(audacityActionDefinition(id), id);
		const calls: unknown[][] = [];
		const handler = resolveAudacityActionHandler(id, dynamicRuntime((...args) => calls.push(args)));
		if (!valid) {
			assert.equal(handler, null, id);
			continue;
		}
		assert.ok(handler, id);
		handler();
		assert.deepEqual(calls, [parameters], id);
	}
	const definitions = Object.values(AUDACITY_ACTION_MANIFEST) as ReadonlyArray<{ id: string; status: string }>;
	for (const definition of definitions.filter((entry) => entry.id.includes('%1'))) {
		const calls: unknown[][] = [];
		const runtime = dynamicRuntime((...args) => calls.push(args));
		const template = resolveAudacityActionHandler(definition.id, runtime);
		if (definition.status !== 'implemented') {
			assert.equal(template, null);
			continue;
		}
		assert.ok(template);
		template(17);
		assert.deepEqual(calls, [[17]]);
		assert.equal(audacityActionDefinition(definition.id.replace('%1', '17')), definition);
	}
});

test('unknown and concrete dynamic lookups perform no repeated manifest enumeration after initialization', (context) => {
	let scans = 0; const values = Object.values;
	context.mock.method(Object, 'values', (value: object) => { if (value === AUDACITY_ACTION_MANIFEST) scans++; return values(value); });
	for (let index = 0; index < 1000; index++) { audacityActionDefinition(`unknown-${index}`); audacityActionDefinition(`${rate}44100`); }
	assert.equal(scans, 0);
});

test('dynamic handlers observe runtime replacements and decorated public menu trees remain independent', () => {
	const calls: unknown[] = []; const runtime = { track: { setRate(value: unknown) { calls.push(value); } } };
	const first = resolveAudacityActionHandler(`${rate}44100`, runtime); const second = resolveAudacityActionHandler(`${rate}44100`, runtime);
	assert.ok(first && second); first(); second(); assert.deepEqual([...calls], [44100, 44100]);
	assert.equal(resolveAudacityActionHandler(`${rate}%`, runtime), null);
	runtime.track.setRate = (value) => { calls.push(['replacement', value]); }; resolveAudacityActionHandler(`${rate}44100`, runtime)!();
	assert.deepEqual(calls.at(-1), ['replacement', 44100]);
	const input = [{ id: 'local-container', items: [{ id: `${rate}44100`, label: '44.1 kHz' }] }];
	const menus = applyAudacityParityToMenus(input); const next = applyAudacityParityToMenus(input);
	assert.notEqual(menus, next); assert.notEqual(menus[0], next[0]); assert.notEqual(menus[0].items, next[0].items);
	menus[0].items.push({ id: 'caller-item' }); assert.equal(next[0].items.length, 1); assert.equal(input[0]!.items.length, 1);
});
