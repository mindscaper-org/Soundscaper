/* SPDX-License-Identifier: AGPL-3.0-only */

export type LightscaperPhotoBackendCurrentV1 = 'web' | 'native';
export type LightscaperPhotoBackendSafetyCurrentV1 = 'ready' | 'busy' | 'open-surface';
export interface LightscaperPhotoBackendWorkspaceCurrentV1 {
	readonly safety: () => LightscaperPhotoBackendSafetyCurrentV1;
	readonly fence: () => void;
	readonly retireAndJoin: () => Promise<void>;
	readonly target: unknown | null;
}
type Registration = LightscaperPhotoBackendWorkspaceCurrentV1;
export interface LightscaperPhotoBackendSnapshotCurrentV1 {
	readonly backend: LightscaperPhotoBackendCurrentV1;
	readonly epoch: number;
	readonly nativeAvailable: boolean;
	readonly ready: boolean;
	readonly busy: boolean;
	readonly failed: boolean;
	readonly safety: LightscaperPhotoBackendSafetyCurrentV1;
	readonly target: unknown | null;
}
/** Menu opt-in owns one exact workspace retirement. Changing both factories is
	* allowed only after the current workspace's real cleanup has succeeded. */
export class LightscaperPhotoBackendSwitchCurrentV1 {
	readonly #nativeAvailable: boolean;
	readonly #listeners = new Set<() => void>();
	#workspace: Registration | undefined;
	#backend: LightscaperPhotoBackendCurrentV1 = 'web';
	#epoch = 0;
	#pending: { management?: boolean; backend: LightscaperPhotoBackendCurrentV1; work: Promise<boolean> } | undefined;
	#failed = false;
	#failure: unknown;
	#closed = false;
	#closing: Promise<void> | undefined;
	#snapshot: Readonly<LightscaperPhotoBackendSnapshotCurrentV1>;
	constructor(options: Readonly<{ nativeAvailable: boolean }>) {
		this.#nativeAvailable = options.nativeAvailable === true;
		this.#snapshot = Object.freeze({ backend: 'web', epoch: 0, nativeAvailable: this.#nativeAvailable,
			ready: false, busy: false, failed: false, safety: 'busy', target: null });
	}
	readonly snapshot = (): Readonly<LightscaperPhotoBackendSnapshotCurrentV1> => this.#snapshot;
	readonly subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
	register(value: LightscaperPhotoBackendWorkspaceCurrentV1): () => void {
		if (this.#closed || this.#failed) return () => undefined;
		const registration: Registration = { safety: () => 'busy', fence: () => undefined, retireAndJoin: async () => undefined, target: null };
		this.#workspace = registration;
		try {
			const safety = value.safety, fence = value.fence, retire = value.retireAndJoin, target = value.target;
			if (typeof safety !== 'function' || typeof fence !== 'function' || typeof retire !== 'function') throw new TypeError('Exact workspace retirement owner required.');
			Object.assign(registration, { safety: () => Reflect.apply(safety, value, []) as LightscaperPhotoBackendSafetyCurrentV1,
				fence: () => Reflect.apply(fence, value, []) as void, retireAndJoin: () => Reflect.apply(retire, value, []) as Promise<void>, target });
			this.refresh();
		} catch (error) { if (this.#workspace === registration) this.#workspace = undefined; this.refresh(); throw error; }
		return () => { if (this.#workspace !== registration) return; this.#workspace = undefined; this.refresh(); };
	}
	refresh(): void {
		const previous = this.#snapshot;
		const safety = this.#closed || this.#failed || !this.#workspace || this.#pending ? 'busy' : this.#workspace.safety();
		const next: LightscaperPhotoBackendSnapshotCurrentV1 = { backend: this.#backend, epoch: this.#epoch, nativeAvailable: this.#nativeAvailable,
			ready: !!this.#workspace && !this.#closed && !this.#failed, busy: !!this.#pending, failed: this.#failed,
			safety, target: this.#workspace?.target ?? null };
		if (Object.keys(next).every(key => Object.is(previous[key as keyof typeof next], next[key as keyof typeof next]))) return;
		this.#snapshot = Object.freeze(next); for (const listener of this.#listeners) listener();
	}
	select(backend: LightscaperPhotoBackendCurrentV1): Promise<boolean> {
		if (this.#failed) return Promise.reject(this.#failure);
		if (this.#closed) return Promise.reject(new Error('Photo backend choice is closed.'));
		if (backend !== 'web' && backend !== 'native') return Promise.reject(new TypeError('Unknown Photo backend.'));
		if (backend === 'native' && !this.#nativeAvailable) return Promise.resolve(false);
		if (this.#pending) return !this.#pending.management && this.#pending.backend === backend ? this.#pending.work : Promise.resolve(false);
		if (backend === this.#backend) return Promise.resolve(false);
		const workspace = this.#workspace; if (!workspace) return Promise.resolve(false);
		let resolve!: (value: boolean) => void, reject!: (reason: unknown) => void;
		const work = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
		const pending = { backend, work }; this.#pending = pending;
		let admitted: boolean;
		try { admitted = workspace.safety() === 'ready'; if (admitted) workspace.fence(); }
		catch (error) { this.#failed = true; this.#failure = error; this.#pending = undefined; this.refresh(); reject(error); return work; }
		if (!admitted) { this.#pending = undefined; this.refresh(); resolve(false); return work; }
		this.refresh();
		void (async () => {
			try {
				await workspace.retireAndJoin();
				if (this.#workspace === workspace) this.#workspace = undefined;
				if (this.#closed) { resolve(false); return; }
				this.#backend = backend; this.#epoch++; resolve(true);
			} catch (error) { this.#failed = true; this.#failure = error; reject(error); }
			finally { if (this.#pending === pending) this.#pending = undefined; this.refresh(); }
		})();
		return work;
	}
 /** A destructive permission transition uses the same full workspace fence,
  * then a fresh matched management Session. It cannot retire itself from an
  * operation running inside the workspace that it is waiting to close. */
 retireAndRun(action:()=>Promise<void>):Promise<boolean>{
  if(this.#failed)return Promise.reject(this.#failure);if(this.#closed)return Promise.reject(new Error('Photo backend choice is closed.'));if(this.#pending)return Promise.resolve(false);
  const workspace=this.#workspace;if(!workspace)return Promise.resolve(false);
  let resolve!:(value:boolean)=>void,reject!:(error:unknown)=>void;const work=new Promise<boolean>((yes,no)=>{resolve=yes;reject=no;}),pending={backend:this.#backend,management:true,work};this.#pending=pending;
  try{if(typeof action!=='function')throw new TypeError('Linked management requires its retirement-bound callback.');if(workspace.safety()!=='ready'){this.#pending=undefined;this.refresh();resolve(false);return work;}workspace.fence();}
  catch(error){this.#failed=true;this.#failure=error;this.#pending=undefined;this.refresh();reject(error);return work;}
  this.refresh();void(async()=>{try{await workspace.retireAndJoin();if(this.#workspace===workspace)this.#workspace=undefined;if(this.#closed){resolve(false);return;}await action();if(this.#closed){resolve(false);return;}this.#epoch++;resolve(true);}
   catch(error){this.#failed=true;this.#failure=error;reject(error);}finally{if(this.#pending===pending)this.#pending=undefined;this.refresh();}})();return work;
 }

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		const pending = this.#pending?.work;
		this.#closing = (async () => { await pending; if (this.#failed) throw this.#failure; })();
		this.refresh(); return this.#closing;
	}
}
