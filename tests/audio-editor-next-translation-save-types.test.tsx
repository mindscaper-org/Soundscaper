/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createPresentationLocalization } from '../src/common/editor/controller/shared/presentation-localization.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from '../src/common/i18n/community-translations-copy.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

// Preserve the shipping notice bytes while admitting its existing Vite raw-text import in Node.
const raw = registerHooks({ load(url, context, nextLoad) {
	if (url.endsWith('/translations/LICENSE.txt?raw')) return {
		format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true,
	};
	return nextLoad(url, context);
} });
const { default: CommunityTranslationSurface } = await import('../src/common/editor/ui/community-translations/CommunityTranslationSurface.tsx');
const { loadCommunityTranslationSnapshot } = await import('../src/common/editor/ui/community-translations/community-translation-files.ts');
raw.deregister();

interface SavePanel {
	readonly defaultPath: string;
	readonly filters: readonly { readonly name: string; readonly extensions: readonly string[] }[];
}

test('real translation buttons and desktop file IPC offer JSON/ZIP save types and tolerate cancellation', { timeout: 15_000 }, async () => {
	const panels: SavePanel[] = [], requests: { purpose: string; suggestedName: string; mimeType: string }[] = [];
	const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
	registerFileCapabilityIpc({
		channels: { chooseFiles: 'open', releaseRead: 'release', chooseSaveTarget: 'save', releaseSaveTarget: 'release-save',
			beginWrite: 'begin', writeChunk: 'chunk', patchFinalPrefix: 'prefix', finishWrite: 'finish', abortWrite: 'abort' },
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
			showSaveDialog: async (_window: unknown, options: SavePanel) => { panels.push(options); return { canceled: true, filePath: '' }; } },
		handle: (channel: string, listener: (event: unknown, value: unknown) => unknown) => { handlers.set(channel, listener); },
		opaqueId: String, ownerFor: () => 'owner', pendingOpenProjects: new Map(),
		readCapabilities: {}, saves: {}, saveTargets: {}, windowFor: () => null,
	});
	const save = handlers.get('save'); assert.ok(save);
	let pending: Promise<unknown> = Promise.resolve();
	const fileService = createAudioEditorFileService({ bridge: { chooseSaveTarget: (request: typeof requests[number]) => {
		requests.push(request); pending = Promise.resolve(save({}, request)); return pending;
	} } });
	const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map<string, string>();
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
		getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
	} });
	const fixture = mountControllerDataDom();
	const localization = createPresentationLocalization({ locale: 'en', publishedCopy: ENGLISH_COPY, englishCopy: ENGLISH_COPY });
	try {
		await loadCommunityTranslationSnapshot('de');
		await fixture.render(<CommunityTranslationSurface port={localization.port} initialLocale="de" copy={ENGLISH_COPY}
			fileService={fileService} onClose={() => undefined} />);
		const copy = COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en;
		for (const [label, extension, mimeType] of [[copy.export, 'json', 'application/json'], [copy.po, 'zip', 'application/zip']] as const) {
			const button = fixture.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(button);
			const before = panels.length;
			await act(async () => { reactProps(button).onClick(); });
			await pending;
			assert.equal(panels.length, before + 1);
			assert.deepEqual(requests.at(-1), { purpose: 'translation', suggestedName: `soundscaper-translations-de.${extension}`, mimeType });
			assert.equal(panels.at(-1)?.defaultPath, `soundscaper-translations-de.${extension}`);
			assert.ok(panels.at(-1)?.filters.flatMap(filter => filter.extensions).includes(extension));
			assert.equal(fixture.dom.container.querySelectorAll('[role="alert"]').length, 0);
		}
	} finally {
		await fixture.dispose(); localization.dispose();
		if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
	}
});
