/* SPDX-License-Identifier: AGPL-3.0-only */
import { checkDesktopDistributionUpdates } from './windows-store-distribution.ts';

interface UpdateResult { readonly status: string; readonly version?: string; readonly message?: string }
interface MessageOptions {
	type: 'info' | 'warning'; title: string; message: string;
	buttons?: string[]; defaultId?: number; cancelId?: number;
}
interface UpdateServiceOptions {
	readonly appName: string;
	readonly portable: boolean;
	readonly windowsStore: boolean | undefined;
	readonly checkRelease: (options: { manual: boolean }) => Promise<UpdateResult>;
	readonly showMessage: (options: MessageOptions) => Promise<{ response: number }>;
	readonly openExternal: (url: string) => Promise<void>;
	readonly install: (when: 'now' | 'next-launch') => Promise<void>;
	readonly installPending: () => Promise<boolean>;
}
export class DesktopUpdateService {
	readonly #options: UpdateServiceOptions;
	#checking: Promise<UpdateResult> | null = null;
	constructor(options: UpdateServiceOptions) { this.#options = options; }
	async startup(): Promise<void> {
		if (this.#options.portable || this.#options.windowsStore) return;
		try {
			if (await this.#options.installPending()) return;
		} catch {
			await this.#options.showMessage({ type: 'warning', title: 'Could not install update', message: 'Please check for updates and try again.' });
		}
		await this.check(false);
	}
	check(manual: boolean): Promise<UpdateResult> {
		if (this.#options.portable) return Promise.resolve({ status: 'portable' });
		if (this.#checking) return this.#checking;
		const checking = this.#check(manual).finally(() => { this.#checking = null; });
		this.#checking = checking;
		return checking;
	}
	async #check(manual: boolean): Promise<UpdateResult> {
		const d = this.#options;
		try {
			const result = await checkDesktopDistributionUpdates({ ...d, manual });
			if (result.status === 'available') {
				const version = result.version ?? '';
				const name = version.startsWith(`${d.appName}.`) || version.startsWith(`${d.appName}-`) ? version : `${d.appName} ${version}`;
				const { response } = await d.showMessage({ type: 'info', title: `${d.appName} update available`,
					message: `${name} is available.`,
					buttons: ['Install now', 'Install on next launch', 'Skip'], defaultId: 0, cancelId: 2 });
				if (response === 0 || response === 1) await d.install(response === 0 ? 'now' : 'next-launch');
			} else if (manual && result.status === 'current') {
				await d.showMessage({ type: 'info', title: `${d.appName} is up to date`, message: 'You are using the newest available release.' });
			} else if (manual && result.status === 'error') {
				await d.showMessage({ type: 'warning', title: 'Could not check for updates', message: result.message ?? 'Could not check for updates.' });
			}
			return result;
		} catch {
			await d.showMessage({ type: 'warning', title: 'Could not install update', message: 'Please check for updates and try again.' });
			return { status: 'error', message: 'Could not install update.' };
		}
	}
}
