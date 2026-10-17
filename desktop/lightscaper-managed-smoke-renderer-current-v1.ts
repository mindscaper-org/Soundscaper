/* SPDX-License-Identifier: AGPL-3.0-only */

import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { lightscaperRestoreCopy } from '../src/common/i18n/lightscaper-restore-copy.ts';
import { readLightscaperManagedSmokeCustodyCurrentV1 } from './lightscaper-managed-smoke-custody-current-v1.ts';
import type { LightscaperSmokeFileCurrentV1, LightscaperSmokeRendererPlanCurrentV1, LightscaperSmokeRendererReportCurrentV1 } from './lightscaper-managed-smoke-contract-current-v1.ts';

/** Statically inventoried main-only automation. Every write uses the actual
 * application's menus/controllers and native File input boundary. */
export async function runLightscaperManagedSmokeCurrentV1(plan: LightscaperSmokeRendererPlanCurrentV1): Promise<LightscaperSmokeRendererReportCurrentV1> {
	const globals = globalThis as unknown as Record<string, unknown>;
	const desktop = globals.lightscaperDesktop as { v1?: { getEnvironment(): Promise<{ locale: string; productId: string }> } } | undefined;
	if (!desktop?.v1) throw new Error('Actual packaged Lightscaper bridge is missing.');
	const environment = await desktop.v1.getEnvironment();
	if (environment.productId !== 'lightscaper' || environment.locale !== plan.locale) throw new Error('Managed smoke requires its genuine English desktop route.');
	const publicBridgeKeys = Object.keys(desktop.v1).sort();
	if (publicBridgeKeys.join(',') !== 'getEnvironment,onCloseRequested,onMenuCommand,respondToClose,signalReady') throw new Error('Packaged Lightscaper bridge authority expanded.');
	const nodeExposed = typeof globals.require !== 'undefined' || typeof globals.process !== 'undefined';
	if (nodeExposed) throw new Error('Node authority leaked into the Photo renderer.');
	const app = await wait(() => document.querySelector<HTMLElement>('[data-lightscaper-bound="true"]'), 'actual Lightscaper app');
	const copy = bundledLightscaperEditorCopyForLocale(plan.locale), develop = photoDevelopCopy(plan.locale), restore = lightscaperRestoreCopy(plan.locale);
	let initial: LightscaperSmokeRendererReportCurrentV1['initial'] = null;
	let preview: LightscaperSmokeRendererReportCurrentV1['preview'] = null;
	if (plan.stage === 1) {
		if (app.querySelector('[data-photo-library]')) throw new Error('The managed Photo Library must remain menu opt-in at first launch.');
		await action(copy.photoImportPhotos);
		const importing = await dialog(copy.photoImportPhotos);
		assignFiles(await wait(() => importing.querySelector<HTMLInputElement>('input[type="file"]'), 'photo import file input'), plan.fixtures);
		await clickButton(importing, copy.photoImportAction);
		await wait(() => !importing.isConnected, 'genuine import completion');
		await library();
		const before = await custody();
		if (!before.photos.every(photo => photo.storage === 'opfs')) throw new Error('First managed imports did not use actual OPFS custody.');
		await selectRaw(); await action(photoDevelopMenuLabel(plan.locale), true);
		const author = await dialog(`${develop.title}: ${rawName()}`);
		await painted(author);
		const beforePixels = plane(author);
		const choose = await wait(() => findLabel<HTMLSelectElement>(author, 'select', develop.choose), 'Develop effect chooser');
		await setValue(choose, 'tone-ladder-v1'); await clickButton(author, develop.add);
		const exposure = await wait(() => findLabel<HTMLInputElement>(author, 'input', `${develop.shared.videoEffectExactValue}: ${develop.shared.videoEffectParamExposure}`), 'exact exposure input');
		await setValue(exposure, '-1'); exposure.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); exposure.blur();
		await wait(() => {
			const after = plane(author);
			return after.width === 32 && after.height === 32 && after.pixels.some((value, index) => value !== beforePixels.pixels[index]);
		}, 'real changed RAW preview');
		await painted(author); preview = plane(author);
		await clickButton(author, develop.save);
		await wait(() => author.querySelector('[data-photo-develop-ack]'), 'durable Develop Save acknowledgement');
		await clickButton(author, develop.close, true); await wait(() => !author.isConnected, 'Develop close');
		const saved = await custody();
		if (saved.fingerprint === before.fingerprint) throw new Error('Develop Save did not publish its actual Photo document.');
		assertSavedExposure(saved);
		await exportRaw(); await backup();
	} else {
		await library(); initial = await custody();
		if (initial.fingerprint !== plan.expectedFingerprint) throw new Error('Fresh process lost the previously saved catalog or Original custody.');
		if (plan.expectedNamespace !== null && initial.namespace !== plan.expectedNamespace) throw new Error('Fresh process selected a different restored namespace.');
		assertSavedExposure(initial);
		if (plan.stage === 2) {
			if (!plan.archive) throw new Error('Second process requires the actual externally authenticated first backup.');
			await action(restore.title);
			const restoring = await dialog(restore.title);
			assignFiles(await wait(() => restoring.querySelector<HTMLInputElement>('[data-photo-restore-file]'), 'restore input'), [plan.archive]);
			await clickSelector(restoring, '[data-photo-restore-start]');
			// Successful publication replaces the Session and its keyed dialog.
			// Observe the new presentation's durable receipt, not the retired node.
			const acknowledged = await wait(() => document.querySelector('[data-photo-restore-receipt]')?.closest<HTMLElement>('[role="dialog"]'), 'actual restore publication receipt');
			await clickSelector(acknowledged, '[data-photo-restore-close]'); await wait(() => !acknowledged.isConnected, 'restore close');
			await library();
		} else {
			await selectRaw(); await action(photoDevelopMenuLabel(plan.locale), true);
			const author = await dialog(`${develop.title}: ${rawName()}`); await painted(author); preview = plane(author);
			await clickButton(author, develop.close, true); await wait(() => !author.isConnected, 'restored Develop close');
			await exportRaw();
		}
	}
	const final = await custody(); assertSavedExposure(final);
	if (plan.stage !== 1 && final.fingerprint !== plan.expectedFingerprint) throw new Error('Restore or export changed the saved document/Original closure.');
	if (plan.stage === 2 && (!final.namespace || final.namespace === initial?.namespace)) throw new Error('Restore did not select a distinct committed library namespace.');
	if (document.querySelector('[role="dialog"]')) throw new Error('Managed smoke left an active presentation at native close.');
	const rawRuntimeRequests = performance.getEntriesByType('resource').map(value => value.name).filter(value => value.includes('/runtime/libraw/'));
	// Worker requests belong to Electron's session witness; this page timeline
	// remains diagnostic and cannot stand in for the worker's native fetches.
	if (rawRuntimeRequests.some(value => !value.startsWith('lightscaper-app://bundle/runtime/libraw/'))) throw new Error('RAW escaped the packaged offline asset route.');
	return { nonce: plan.nonce, stage: plan.stage, initial, final, preview, rawRuntimeRequests, publicBridgeKeys, nodeExposed };

	function rawName(): string { const file = plan.fixtures.find(value => value.name.endsWith('.dng')); if (!file) throw new Error('Owned DNG missing.'); return file.name; }
	async function menu(name: string): Promise<void> {
		const summary = await wait(() => [...app.querySelectorAll<HTMLElement>('summary')].find(value => text(value) === name), `menu ${name}`);
		if (!(summary.parentElement instanceof HTMLDetailsElement)) throw new Error('Photo menu has no native details owner.');
		if (!summary.parentElement.open) summary.click();
	}
	async function action(name: string, nested = false): Promise<void> { await menu(copy.photoFileMenu); if (nested) await menu(copy.photoPhotoMenu); await clickButton(app, name); }
	async function library(): Promise<void> {
		if (!app.querySelector('[data-photo-library]')) { await menu(copy.photoViewMenu); await clickButton(app, copy.photoShowLibrary); }
		await wait(() => { const node = app.querySelector('[data-photo-library]'); return node?.getAttribute('aria-busy') === 'false' && node.querySelectorAll('[data-photo-id]').length === 2; }, 'two actual resident Photo cards');
	}
	function ids(): string[] { return [...app.querySelectorAll<HTMLElement>('[data-photo-library] [data-photo-id]')].map(value => value.dataset.photoId!).filter(Boolean); }
	async function custody() { return await readLightscaperManagedSmokeCustodyCurrentV1(ids(), plan.fixtures); }
	async function selectRaw(): Promise<void> {
		const card = await wait(() => [...app.querySelectorAll<HTMLButtonElement>('[data-photo-library] [data-photo-id]')].find(value => value.querySelector('strong')?.textContent === rawName()), 'owned DNG Photo card');
		card.click(); await wait(() => card.getAttribute('aria-pressed') === 'true', 'actual DNG selection');
	}
	async function exportRaw(): Promise<void> {
		await selectRaw(); await menu(copy.photoFileMenu); await clickSelector(app, '[data-photo-png-export-menu]');
		const surface = await wait(() => document.querySelector<HTMLElement>('[data-photo-png-export-dialog]'), 'actual PNG output settings');
		const owner = surface.closest<HTMLElement>('[role="dialog"]'); if (!owner) throw new Error('PNG surface lost its dialog owner.');
		await clickSelector(owner, '[data-photo-png-export-save]');
		await wait(() => owner.querySelector('[data-photo-png-export-receipt]')?.getAttribute('data-photo-png-export-status') === 'download-started', 'genuine native PNG download dispatch');
		await clickSelector(owner, '[data-photo-png-export-close]'); await wait(() => !owner.isConnected, 'PNG export close');
	}
	async function backup(): Promise<void> {
		await action(copy.photoBackupTitle); const owner = await dialog(copy.photoBackupTitle);
		await clickSelector(owner, '[data-photo-backup-save]');
		await wait(() => owner.querySelector('[data-photo-backup-receipt]')?.getAttribute('data-photo-backup-status') === 'download-started', 'actual Archive8 backup download dispatch');
		await clickSelector(owner, '[data-photo-backup-close]'); await wait(() => !owner.isConnected, 'backup close');
	}
	async function painted(owner: HTMLElement): Promise<void> { await wait(() => owner.querySelector('[data-photo-develop-preview]')?.getAttribute('data-state') === 'ready', 'real native Develop preview'); }
	function plane(owner: HTMLElement) {
		const canvas = owner.querySelector<HTMLCanvasElement>('[data-photo-develop-after]');
		if (!canvas || !canvas.width || !canvas.height || canvas.width * canvas.height > 4096) return { width: 0, height: 0, pixels: [] };
		const context = canvas.getContext('2d'); if (!context) throw new Error('Real Develop display context unavailable.');
		return { width: canvas.width, height: canvas.height, pixels: [...context.getImageData(0, 0, canvas.width, canvas.height).data] };
	}
}
function assertSavedExposure(value: LightscaperSmokeRendererReportCurrentV1['final']): void {
	const raw = value.photos.find(photo => {
		const document = photo.document as { metadata?: { fileName?: string } }; return document.metadata?.fileName?.endsWith('.dng');
	});
	if (!raw) throw new Error('Saved DNG Photo missing.');
	const photo = raw.document as { activeVersionId: string; versions: { id: string; develop: { effects: { type: string; params: { exposure?: number } }[] } }[] };
	const effects = photo.versions.find(version => version.id === photo.activeVersionId)?.develop.effects;
	if (!effects || effects.length !== 1 || effects[0]?.type !== 'tone-ladder-v1' || effects[0].params.exposure !== -1) throw new Error('Saved active RAW Develop recipe differs from the authored exposure.');
}
function text(node: Element): string { return (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().replace(/\s+/gu, ' '); }
function findLabel<Value extends HTMLElement>(root: ParentNode, selector: string, name: string): Value | undefined {
	return [...root.querySelectorAll<Value>(selector)].find(value => {
		if (value.getAttribute('aria-label') === name) return true;
		if (!(value instanceof HTMLInputElement) && !(value instanceof HTMLSelectElement)) return false;
		return [...value.labels ?? []].some(label => {
			const copy = label.cloneNode(true) as HTMLElement;
			for (const control of copy.querySelectorAll('input,select,textarea,button')) control.remove();
			return text(copy) === name;
		});
	});
}
async function dialog(name: string): Promise<HTMLElement> {
	return await wait(() => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(value => {
		const label = value.getAttribute('aria-label') ?? (value.getAttribute('aria-labelledby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ');
		return label.trim() === name;
	}), `dialog ${name}`);
}
async function clickButton(root: ParentNode, name: string, last = false): Promise<void> {
	const node = await wait(() => { const values = [...root.querySelectorAll<HTMLButtonElement>('button')].filter(value => text(value) === name && !value.disabled); return last ? values.at(-1) : values[0]; }, `enabled button ${name}`);
	node.focus(); node.click();
}
async function clickSelector(root: ParentNode, selector: string): Promise<void> {
	const node = await wait(() => { const value = root.querySelector<HTMLButtonElement>(selector); return value && !value.disabled ? value : undefined; }, `enabled ${selector}`);
	node.focus(); node.click();
}
async function setValue(node: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
	const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
	const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
	if (!setter) throw new Error('Native form setter unavailable.');
	Reflect.apply(setter, node, [value]); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
	// Native typing and the later Save click occupy different browser turns.
	// Let React commit this controlled field before automating the next action.
	await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve(); }); });
}
function assignFiles(node: HTMLInputElement, files: readonly LightscaperSmokeFileCurrentV1[]): void {
	const transfer = new DataTransfer();
	for (const input of files) {
		const binary = atob(input.base64); if (binary.length !== input.byteLength || binary.length > 1_048_576) throw new RangeError('Owned File input exceeds its bound.');
		const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
		transfer.items.add(new File([bytes], input.name, { type: input.mimeType, lastModified: 0 }));
	}
	node.files = transfer.files; node.dispatchEvent(new Event('change', { bubbles: true }));
}
async function wait<Value>(read: () => Value | null | undefined | false, label: string): Promise<NonNullable<Value>> {
	return await new Promise((resolve, reject) => {
		const observer = new MutationObserver(check);
		const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`Managed smoke timed out awaiting ${label}; alerts: ${[...document.querySelectorAll('[role="alert"]')].map(node => node.textContent).join(' | ')}`)); }, 45_000);
		function check(): void {
			try { const value = read(); if (value) { clearTimeout(timer); observer.disconnect(); resolve(value as NonNullable<Value>); } }
			catch (error) { clearTimeout(timer); observer.disconnect(); reject(error); }
		}
		observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); check();
	});
}
