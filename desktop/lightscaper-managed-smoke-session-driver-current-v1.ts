/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrowserWindow } from 'electron';
import type { LightscaperSmokeRendererPlanCurrentV1 as Plan, LightscaperSmokeRendererReportCurrentV1 as Report } from './lightscaper-managed-smoke-contract-current-v1.ts';
import { installLightscaperManagedSmokeNativeObserverCurrentV1 } from './lightscaper-managed-smoke-native-custody-current-v1.ts';
type Observer = ReturnType<typeof installLightscaperManagedSmokeNativeObserverCurrentV1>;
const GLOBAL = 'LightscaperManagedSmokeCurrentV1';
function documentOwner(window: BrowserWindow) {
	const contents = window.webContents, frame = contents.mainFrame, url = contents.getURL(); let navigated = false;
	const changed = (_event: unknown, _url: string, _inPlace: boolean, main: boolean): void => { if (main) navigated = true; };
	contents.on('did-start-navigation', changed);
	const check = (): void => { if (navigated || window.isDestroyed() || contents.isDestroyed() || contents.mainFrame !== frame || contents.getURL() !== url) throw new Error('Managed smoke document retired during an actual native operation.'); };
	return { check, detach: () => { contents.removeListener('did-start-navigation', changed); },
		async execute<Value>(source: string): Promise<Value> { check(); const result: unknown = await contents.executeJavaScript(source, true); check(); return result as Value; } };
}
export async function prepareLightscaperManagedSmokeRendererCurrentV1(window: BrowserWindow, script: string, plan: Plan): Promise<void> {
	const owner = documentOwner(window);
	try { await owner.execute(`${script}\n; ${GLOBAL}.prepareLightscaperManagedSmokeNativeCurrentV1(${JSON.stringify({ stage: plan.stage, locale: plan.locale, backend: plan.backend ?? 'web' })});`); }
	finally { owner.detach(); }
}
/** Console is only a bounded wakeup from the inventoried IIFE. The actual
	* request and response cross fixed executeJS expressions on this exact frame. */
export async function runLightscaperManagedSmokeRendererCurrentV1(window: BrowserWindow, plan: Plan, observer: Observer | undefined): Promise<Report> {
	const owner = documentOwner(window), tasks = new Set<Promise<void>>(), seen = new Set<number>();
	const prefix = `LightscaperManagedCustody:${plan.nonce}:`; let failed = false, primary: unknown;
	const wake = (details: Electron.Event<Electron.WebContentsConsoleMessageEventParams>): void => {
		if (!details.message.startsWith(prefix)) return;
		const id = Number(details.message.slice(prefix.length));
		if (!Number.isSafeInteger(id) || id < 1 || id > 3 || seen.has(id)) return;
		seen.add(id);
		const work = (async () => {
			owner.check();
			const request = await owner.execute<{ id: number; photoIds: readonly string[] } | null>(`${GLOBAL}.takeLightscaperManagedSmokeCustodyCurrentV1()`);
			if (!observer || !request || request.id !== id || !Array.isArray(request.photoIds) || request.photoIds.length !== 2) throw new Error('Native smoke checkpoint is not owned by its actual Main lease.');
			const report = await observer.read(request.photoIds, plan.fixtures); owner.check();
			if (JSON.stringify(report).length > 512 * 1024) throw new RangeError('Native smoke custody report exceeds its bound.');
			await owner.execute(`${GLOBAL}.deliverLightscaperManagedSmokeCustodyCurrentV1(${id},${JSON.stringify(report)});`);
		})().catch(async (error: unknown) => {
			failed = true; primary = error;
			try { await owner.execute(`${GLOBAL}.rejectLightscaperManagedSmokeCustodyCurrentV1(${id});`); } catch { /* The actual frame retirement owns this refusal. */ }
		});
		tasks.add(work); void work.then(() => { tasks.delete(work); });
	};
	window.webContents.on('console-message', wake);
	let report: Report | undefined;
	try { report = await owner.execute<Report>(`${GLOBAL}.runLightscaperManagedSmokeCurrentV1(${JSON.stringify(plan)});`); }
	catch (error) { failed = true; primary = error; }
	const results = await Promise.allSettled([...tasks]);
	window.webContents.removeListener('console-message', wake); owner.detach();
	for (const result of results) if (result.status === 'rejected') { if (!failed) { failed = true; primary = result.reason as unknown; } }
	if (failed) throw primary; if (!report) throw new Error('Managed smoke did not return its actual renderer report.'); return report;
}
