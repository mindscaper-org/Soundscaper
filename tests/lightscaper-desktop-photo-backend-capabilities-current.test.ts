/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { captureDesktopPhotoBackendPortsCurrentV1 as capture } from '../src/lightscaper/desktop-photo-library-backend-current-v1.ts';

void test('Desktop opt-in needs the complete matched installed pair and captures each actual receiver before replacement', async () => {
 const calls: string[] = [], session = { invoke(channel: string, payload: unknown) { assert.ok(Object.is(this, session)); calls.push(channel); return Promise.resolve(payload); },
  installRetirement(openId: string, _handler: (kind: 'stop' | 'retire') => Promise<void>) { assert.ok(Object.is(this, session)); calls.push(openId); return () => { calls.push('detached'); }; } };
 const restore = { invoke(channel: string, payload: unknown) { assert.ok(Object.is(this, restore)); calls.push(channel); return Promise.resolve(payload); } };
 const ports = capture({ v1: { photoSession: session, photoRestore: restore } }); assert.ok(ports);
 session.invoke = () => { throw new Error('Replaced Session invoke must not be read.'); };
 session.installRetirement = () => { throw new Error('Replaced retirement installer must not be read.'); };
 restore.invoke = () => { throw new Error('Replaced restore invoke must not be read.'); };
 assert.equal(await ports.session.invoke('session', 1), 1); assert.equal(await ports.restore.invoke('restore', 2), 2);
 const detach = ports.session.installRetirement('opening', async () => undefined); detach(); assert.deepEqual(calls, ['session', 'restore', 'opening', 'detached']);
});
void test('Browser default is preserved when either complete installed transport is absent; probing never opens native storage', () => {
 let opens = 0; const invoke = async () => { opens++; return undefined; }, installRetirement = () => () => undefined;
 for (const value of [undefined, {}, { v1: {} }, { v1: { photoSession: { invoke, installRetirement } } },
  { v1: { photoRestore: { invoke } } }, { v1: { photoSession: { invoke }, photoRestore: { invoke } } }]) assert.equal(capture(value), undefined);
 assert.equal(opens, 0);
});
