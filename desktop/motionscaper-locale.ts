/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MenuItemConstructorOptions } from 'electron';
import { resolveMotionscaperLocaleCopy } from '../src/common/i18n/editor-motionscaper-locale-copy.ts';
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveMotionDesktopLocale, validateMotionDesktopLocale } from '../src/motionscaper/desktop-locale-contract.ts';
import { motionscaperDesktopDocumentUrl } from './motionscaper-desktop-contract.ts';

/** Locale-only, product-private settings; no foreign desktop service is imported. */
export class MotionscaperLocaleSettings {
	#locale = 'en';
	#tail: Promise<unknown> = Promise.resolve();
	constructor(readonly filePath: string) {}
	get locale(): string { return this.#locale; }
	async load(preferred: readonly unknown[]): Promise<string> {
		let value: unknown;
		try { value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown; }
		catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
		if (value && typeof value === 'object' && !Array.isArray(value) && Reflect.get(value, 'schemaVersion') === 1) {
			try { this.#locale = validateMotionDesktopLocale(Reflect.get(value, 'locale')); return this.#locale; } catch { /* Resolve the actual system preference below. */ }
		}
		return await this.set(resolveMotionDesktopLocale(preferred));
	}
	set(value: unknown): Promise<string> {
		const locale = validateMotionDesktopLocale(value);
		const next = this.#tail.then(async () => {
			await this.#write(locale); this.#locale = locale; return locale;
		});
		this.#tail = next.then(() => undefined, () => undefined); return next;
	}
	async #write(locale: string): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		const temporary = `${this.filePath}.${randomBytes(8).toString('hex')}.tmp`;
		const handle = await open(temporary, 'wx', 0o600);
		try {
			await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, locale }, null, 2)}\n`, 'utf8');
			await handle.sync(); await handle.close(); await rename(temporary, this.filePath);
		} catch (error) { await handle.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); throw error; }
	}
}

export async function dispatchMotionscaperLocale(context: Readonly<{ ownWindow: boolean; mainFrame: boolean; url: string }>,
	request: unknown, set: (locale: string) => Promise<string>): Promise<string> {
	if (!context.ownWindow || !context.mainFrame || !motionscaperDesktopDocumentUrl(context.url)) throw new Error('Untrusted Motionscaper locale caller.');
	if (!request || typeof request !== 'object' || Array.isArray(request) || Reflect.ownKeys(request).length !== 1 || !Object.hasOwn(request, 'locale')) throw new TypeError('Invalid Motionscaper locale request.');
	return await set(validateMotionDesktopLocale(Reflect.get(request, 'locale')));
}


export function createMotionscaperNativeMenu(locale: string, platform: string): MenuItemConstructorOptions[] | null {
	// The shared desktop convention keeps native menu roles only on macOS.
	if (platform !== 'darwin') return null;
	const copy = resolveMotionscaperLocaleCopy(locale);
	return [
		...(platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
		{ label: copy.motionscaperNativeFileMenu, submenu: [{ role: 'close' }] },
		{ label: copy.motionscaperNativeEditMenu, role: 'editMenu' },
		{ label: copy.motionscaperNativeViewMenu, role: 'viewMenu' },
		{ label: copy.motionscaperNativeWindowMenu, role: 'windowMenu' },
	];
}
