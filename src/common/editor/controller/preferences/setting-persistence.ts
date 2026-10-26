/* SPDX-License-Identifier: AGPL-3.0-only */

export type SettingPersistencePolicy = 'required' | 'best-effort';

export interface SettingPersistenceOptions {
	readonly policy?: SettingPersistencePolicy;
	/** An owning collection may supply an atomic write while retaining warning/drain semantics. */
	readonly write?: () => Promise<unknown>;
}

export interface SettingPersistencePort {
	persist<Value>(
		key: string,
		value: Value,
		options?: SettingPersistenceOptions,
	): Promise<Value | null>;
}

export function createSettingPersistence({
	write,
	isInactive = () => false,
	onWarning = () => undefined,
}: {
	readonly write: (key: string, value: unknown) => Promise<unknown>;
	readonly isInactive?: () => boolean;
	readonly onWarning?: (error: unknown, key: string) => void;
}): Readonly<SettingPersistencePort & {
	clearStorage(clear: () => Promise<unknown>, reset: () => void, prepare: () => Promise<unknown>): Promise<void>;
}> {
	if (typeof write !== 'function') throw new TypeError('A settings write port is required.');
	const pending = new Set<Promise<unknown>>();
	let clearing = false;
	return Object.freeze({
		async persist<Value>(
			key: string,
			value: Value,
			{ policy = 'best-effort', write: writeOperation }: SettingPersistenceOptions = {},
		): Promise<Value | null> {
			if (clearing) throw new DOMException('Local editor settings are being cleared.', 'InvalidStateError');
			let operation: Promise<unknown> | null = null;
			try {
				operation = writeOperation ? writeOperation() : write(key, value);
				pending.add(operation);
				await operation;
				return value;
			} catch (error) {
				if (!isInactive()) onWarning(error, key);
				if (policy === 'required') throw error;
				return null;
			} finally {
				if (operation) pending.delete(operation);
			}
		},
		async clearStorage(clear: () => Promise<unknown>, reset: () => void, prepare: () => Promise<unknown>) {
			await prepare();
			clearing = true;
			try {
				while (pending.size) await Promise.allSettled([...pending]);
				await clear();
				reset();
			} finally {
				clearing = false;
			}
		},
	});
}
