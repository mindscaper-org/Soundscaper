/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';

async function archive(id: string, title: string) {
	const blob = await exportMotionscaperArchive(createMotionscaperProject({ id, title, compositionId: 'comp', width: 32, height: 32, durationFrames: 2 }), () => null);
	if (!blob) throw new Error('Archive missing.'); return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
interface State { readonly acks: string[]; readonly binds: string[]; readonly reads: string[]; readonly releases: string[]; readonly takes: number }
async function install(page: Page, name: string, failRelease: boolean) {
	await page.addInitScript(({ cold, warm, name, failRelease }) => {
		type Selected = { token: string; name: string; bytes?: number[] };
		const queue: Selected[] = [{ token: 'cold', name: 'original.mscape', bytes: cold }], held = new Map<string, Selected>();
		const acks: string[] = [], binds: string[] = [], reads: string[] = [], releases: string[] = []; let takes = 0, failed = false, manual = false;
		let listener = () => undefined as void;
		const selected = (file: Selected) => { held.set(file.token, file); return { token: file.token, name: file.name, byteLength: file.bytes?.length ?? 4096 }; };
		Object.defineProperty(globalThis, '__motionAdobeState', { value: () => ({ acks, binds, reads, releases, takes }) });
		Object.defineProperty(globalThis, '__motionAdobeSelect', { value: () => { manual = true; } });
		Object.defineProperty(globalThis, '__motionAdobeWarm', { value: () => { queue.push({ token: 'warm', name: 'warm.mscape', bytes: warm }); listener(); } });
		Object.defineProperty(globalThis, 'scapeDesktop', { value: { v1: { getEnvironment: async () => ({ locale: 'en' }), motionFiles: {
			selectOpen: async () => { if (!manual) return null; manual = false; return selected({ token: 'adobe', name }); },
			read: async ({ token, offset, length }: { token: string; offset: number; length: number }) => {
				reads.push(token); const bytes = held.get(token)?.bytes; if (!bytes) throw new Error('Adobe project bytes must not be read.');
				return new Uint8Array(bytes.slice(offset, offset + length));
			},
			release: async ({ token }: { token: string }) => { releases.push(token); if (token === 'adobe' && failRelease && !failed) { failed = true; throw new Error('Native release failed.'); } held.delete(token); },
			bindOpened: async ({ token, projectId }: { token: string; projectId: string }) => { if (token === 'adobe') throw new Error('Adobe must not replace the native Save binding.'); binds.push(projectId); },
			beginSave: async () => null, write: async () => undefined, commit: async () => { throw new Error('Not a save.'); }, cancel: async () => undefined,
		}, motionLaunch: {
			take: async () => { takes++; const next = queue.shift(); return next ? selected(next) : null; },
			acknowledge: async ({ token }: { token: string }) => { if (held.has(token)) throw new Error('ACK before close.'); acks.push(token); },
			onPending: (callback: () => void) => { listener = callback; return () => { listener = () => undefined; }; },
		} } } });
	}, { cold: await archive('adobe-native-original', 'Native original'), warm: await archive('adobe-native-warm', 'Warm project'), name, failRelease });
}
async function menu(page: Page, top: string, item: string) {
	await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click();
}
async function state(page: Page): Promise<State> { return await page.evaluate(() => (Reflect.get(globalThis, '__motionAdobeState') as () => State)()); }
async function chooseAdobe(page: Page) { await page.evaluate(() => { (Reflect.get(globalThis, '__motionAdobeSelect') as () => void)(); }); await menu(page, 'File', 'Open'); }
async function warm(page: Page) { await page.evaluate(() => { (Reflect.get(globalThis, '__motionAdobeWarm') as () => void)(); }); }
async function dirty(page: Page) {
	await menu(page, 'View', 'Composition Settings'); const settings = page.getByRole('dialog', { name: 'Composition Settings', exact: true });
	await settings.getByLabel('Project title', { exact: true }).fill('Unsaved Adobe draft'); await settings.getByRole('button', { name: 'Apply', exact: true }).click();
}
async function bridge(page: Page, name: string) {
	const dialog = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true }); await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(name); await expect(dialog).toContainText('Open this project in installed After Effects');
	await expect(dialog.getByRole('button', { name: 'Review Import', exact: true })).toBeDisabled();
	expect((await state(page)).reads).not.toContain('adobe'); expect((await state(page)).binds).toEqual(['adobe-native-original']);
	return dialog;
}

test('native File Open routes AEP to name-only bridge instructions while dirty history and native binding remain intact', async ({ page }) => {
	await install(page, 'Original.aep', false); await page.goto('/embed/en/');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Native original'); await expect.poll(async () => (await state(page)).acks).toEqual(['cold']);
	await dirty(page); await chooseAdobe(page); const dialog = await bridge(page, 'Original.aep');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Unsaved Adobe draft'); expect((await state(page)).releases.filter(token => token === 'adobe')).toHaveLength(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await menu(page, 'Edit', 'Undo'); await expect(page.locator('[data-motion-project-title]')).toHaveText('Native original');
	await menu(page, 'Edit', 'Redo'); await expect(page.locator('[data-motion-project-title]')).toHaveText('Unsaved Adobe draft');
	await menu(page, 'File', 'After Effects Bridge'); const dedicated = page.getByRole('dialog', { name: 'After Effects Bridge', exact: true }); await expect(dedicated).toBeVisible();
	const before = await state(page); await warm(page); expect((await state(page)).takes).toBe(before.takes); expect((await state(page)).acks).toEqual(['cold']);
	await dedicated.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.locator('[data-motion-project-title]')).toHaveText('Warm project');
	await expect.poll(async () => (await state(page)).acks).toEqual(['cold', 'warm']); expect((await state(page)).binds).toEqual(['adobe-native-original', 'adobe-native-warm']);
});

test('native AEPX release retry retains bridge intent and defers a queued warm project through bridge close', async ({ page }) => {
	await install(page, 'Original.AEPX', true); await page.goto('/embed/en/'); await expect(page.locator('[data-motion-project-title]')).toHaveText('Native original');
	await expect.poll(async () => (await state(page)).acks).toEqual(['cold']); await dirty(page); await chooseAdobe(page);
	const cleanup = page.getByRole('dialog', { name: 'Open', exact: true }); await expect(cleanup).toContainText('selected native file is still retained');
	const before = await state(page); await warm(page); expect((await state(page)).takes).toBe(before.takes);
	await cleanup.getByRole('button', { name: 'Retry Completion', exact: true }).click(); const dialog = await bridge(page, 'Original.AEPX');
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Unsaved Adobe draft');
	expect((await state(page)).takes).toBe(before.takes); expect((await state(page)).acks).toEqual(['cold']);
	expect((await state(page)).releases.filter(token => token === 'adobe')).toHaveLength(2);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.locator('[data-motion-project-title]')).toHaveText('Warm project');
	await expect.poll(async () => (await state(page)).acks).toEqual(['cold', 'warm']);
});
