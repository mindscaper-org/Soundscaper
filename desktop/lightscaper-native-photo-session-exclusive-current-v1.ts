/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LightscaperNativePhotoSessionLeaseCurrentV1 as Lease } from './lightscaper-native-photo-session-lease-current-v1.ts';
import type { LightscaperNativePhotoSessionHandlesCurrentV1 as Handles } from './lightscaper-native-photo-session-handles-current-v1.ts';
interface Active { readonly id: string; readonly children: Set<Promise<unknown>>; ending: boolean; end(): Promise<void> }
export class LightscaperNativePhotoSessionExclusiveCurrentV1 {
	readonly #lease: Lease; readonly #handles: Handles;
	#active: Active | undefined;
	constructor(lease: Lease, handles: Handles) { this.#lease = lease; this.#handles = handles; }
	admit(id: string | null, work?: Promise<unknown>): void {
		const active = this.#active;
		if (active ? active.ending || id !== active.id : id !== null) throw new Error('Native request differs from the actual exclusive callback lane.');
		if (active && work) { active.children.add(work); void work.then(() => { active.children.delete(work); }, () => { active.children.delete(work); }); }
	}
	begin(signal: AbortSignal, reserved?: ReturnType<Handles['reserve']>): Promise<unknown> {
		if (this.#active) { reserved?.abandon(); return Promise.reject(new Error('Native Session exclusive callback is already active.')); }
		const booking = reserved ?? this.#handles.reserve('exclusive'); let ready!: () => void, release!: () => void;
		const acquired = new Promise<void>(resolve => { ready = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
		let ending: Promise<void> | undefined;
		const active: Active = { id: booking.handle.id, children: new Set(), ending: false, end: () => {
			if (ending) return ending; active.ending = true;
			ending = Promise.resolve().then(async () => { await Promise.allSettled([...active.children]); release(); await actual; if (this.#active === active) this.#active = undefined; }); return ending;
		} };
		this.#active = active;
		let actual: Promise<void>;
		try { actual = this.#lease.exclusive(this.#lease.catalogId, async () => { ready(); await gate; }, signal); }
		catch (error) { actual = Promise.reject(error); }
		void actual.catch(() => undefined);
		booking.publish({ close: active.end });
		return Promise.race([acquired, actual.then(() => { throw new Error('Native exclusive callback ended before acquisition.'); })]).then(() => ({ handle: booking.handle }), async primary => {
			try { await this.#handles.close(booking.handle, 'exclusive'); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native exclusive acquisition and retirement failed.', { cause: cleanup }); } throw primary;
		});
	}
}
