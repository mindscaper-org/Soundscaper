/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { StrictMode } from 'react';
import LightscaperBootstrap from '../src/lightscaper/ui/LightscaperBootstrap.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';

for (const custom of [false, true]) void test(`Actual StrictMode Bootstrap keeps default Web cold; custom factory opt-in=${custom} preserves host ownership`, async () => {
 let opens = 0, listeners = 0;
 const invoke = async () => { opens++; throw new Error('Mounting must not open native storage.'); };
 const mounted = await mountPhotoImportUi(() => {
  Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
  Object.defineProperty(window, 'lightscaperDesktop', { configurable: true, value: { v1: {
   signalReady: async () => undefined, onCloseRequested: () => () => undefined, respondToClose: async () => undefined,
   photoSession: { invoke, installRetirement: () => { listeners++; return () => undefined; } }, photoRestore: { invoke },
  } } });
  return <StrictMode><LightscaperBootstrap locale="en" {...(custom ? { createSession: async () => { throw new Error('Injected Session must remain lazy.'); } } : {})} /></StrictMode>;
 });
 try {
  assert.equal(opens, 0); assert.equal(listeners, 0); assert.equal(mounted.dom.find('[data-photo-library]'), null);
  const menu = mounted.dom.find('[data-photo-backend-menu]');
  if (custom) assert.equal(menu, null);
  else { assert.ok(menu); const file = mounted.dom.one('[data-photo-restore-menu]').closest('[name="lightscaper-application-menu"]'); assert.ok(file?.contains(menu));
   assert.equal(mounted.dom.one('[data-photo-backend-choice="web"]').getAttribute('aria-checked'), 'true');
   assert.equal(mounted.dom.one('[data-photo-backend-choice="native"]').getAttribute('aria-checked'), 'false'); }
 } finally { await mounted.dispose(); }
});
