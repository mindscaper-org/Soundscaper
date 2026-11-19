/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/foundation/closed-domain-value.ts';
import { DESKTOP_PHOTO_CLONE_LIMITS_CURRENT_V1 as LIMITS, transformDesktopPhotoCloneGraphCurrentV1 as transform } from './desktop-photo-clone-graph-current-v1.ts';

const CLONE = globalThis.structuredClone, READ = Blob.prototype.arrayBuffer;
type HostWire = readonly [object, 'blob' | 'file', string, number, string | null, number | null, Uint8Array];
const owned = new WeakMap<object, readonly Uint8Array[]>();

/** Synchronous nonmutating capacity admission before native clone/copy or
 * publisher acquisition. The result is descriptive transfer debt only. */
export function measureDesktopPhotoCloneCurrentV1(value: unknown): number {
	const input = record(value, 'desktop Photo clone', ['schemaVersion', 'kind', 'value', 'hosts']);
	if (field(input, 'schemaVersion', 'desktop Photo clone') !== 1 || field(input, 'kind', 'desktop Photo clone') !== 'desktop-photo-clone') throw invalid();
	const list = field(input, 'hosts', 'desktop Photo clone');
	if (!Array.isArray(list) || list.length > LIMITS.maximumObjects) throw invalid();
	const hosts = new Map<object, Blob>(), empty = new Blob(); let bytes = 0;
	for (const item of list as unknown[]) {
		if (!Array.isArray(item) || item.length !== 7 || Object.keys(item).length !== 7) throw invalid();
		for (let index = 0; index < 7; index++) { const own = Object.getOwnPropertyDescriptor(item, index); if (!own || !Object.hasOwn(own, 'value')) throw invalid(); }
		const [placeholder, kind, type, size, name, modified, body] = item as unknown[];
		if (!placeholder || typeof placeholder !== 'object' || Object.getPrototypeOf(placeholder) !== Object.prototype || Reflect.ownKeys(placeholder).length || hosts.has(placeholder)
			|| (kind !== 'blob' && kind !== 'file') || typeof type !== 'string' || !Number.isSafeInteger(size) || (size as number) < 0
			|| !(body instanceof Uint8Array) || !(body.buffer instanceof ArrayBuffer) || body.byteOffset !== 0 || body.byteLength !== body.buffer.byteLength || body.byteLength !== size
			|| (kind === 'blob' ? name !== null || modified !== null : typeof name !== 'string' || typeof modified !== 'number' || !Number.isFinite(modified))) throw invalid();
		bytes += body.byteLength + type.length * 2 + (typeof name === 'string' ? name.length * 2 : 0) + 64;
		if (bytes > LIMITS.maximumBytes) throw new RangeError('Desktop Photo clone exceeds its host byte capacity.');
		hosts.set(placeholder, empty);
	}
	return transform(field(input, 'value', 'desktop Photo clone'), hosts, bytes, true).byteLength;
}

/** Native clone capture happens synchronously before the first await. Only
 * bounded Blob host bytes need an explicit portable Electron representation. */
export async function captureDesktopPhotoCloneCurrentV1(value: unknown): Promise<unknown> {
	const graph = transform(CLONE(value), null), hosts: HostWire[] = [];
	try {
		for (const host of graph.hosts) {
			const bytes = new Uint8Array(await Reflect.apply(READ, host.blob, []) as ArrayBuffer);
			if (bytes.byteLength !== host.size) { bytes.fill(0); throw new Error('Desktop Photo clone host bytes changed.'); }
			hosts.push([host.placeholder, host.kind, host.type, host.size, host.name, host.lastModified, bytes]);
		}
		const wire = Object.freeze({ schemaVersion: 1, kind: 'desktop-photo-clone', value: graph.value, hosts });
		owned.set(wire, hosts.map(host => host[6])); return wire;
	} catch (error) { for (const host of hosts) host[6].fill(0); throw error; }
}

/** A graph envelope is descriptive data, never native provenance or a file
 * capability. Own records and complete host use are checked before delivery. */
export function readDesktopPhotoCloneCurrentV1(value: unknown): Promise<unknown> {
	try {
		measureDesktopPhotoCloneCurrentV1(value);
		const input = record(value, 'desktop Photo clone', ['schemaVersion', 'kind', 'value', 'hosts']);
		if (field(input, 'schemaVersion', 'desktop Photo clone') !== 1 || field(input, 'kind', 'desktop Photo clone') !== 'desktop-photo-clone') throw invalid();
		const snapshot: unknown = CLONE(input), captured = record(snapshot, 'desktop Photo clone', ['schemaVersion', 'kind', 'value', 'hosts']);
		const list = field(captured, 'hosts', 'desktop Photo clone');
		if (!Array.isArray(list) || list.length > LIMITS.maximumObjects) throw invalid();
		const hosts = new Map<object, Blob>(), bytes: Uint8Array[] = []; let total = 0;
		try {
			for (const item of list as unknown[]) {
				if (!Array.isArray(item) || item.length !== 7 || Object.keys(item).length !== 7) throw invalid();
				for (let index = 0; index < 7; index++) if (!Object.hasOwn(item, index)) throw invalid();
				const [placeholder, kind, type, size, name, modified, body] = item as unknown[];
				if (!placeholder || typeof placeholder !== 'object' || Object.getPrototypeOf(placeholder) !== Object.prototype || Reflect.ownKeys(placeholder).length || hosts.has(placeholder)
					|| (kind !== 'blob' && kind !== 'file') || typeof type !== 'string' || !Number.isSafeInteger(size) || (size as number) < 0
					|| !(body instanceof Uint8Array) || (typeof SharedArrayBuffer !== 'undefined' && body.buffer instanceof SharedArrayBuffer) || body.byteLength !== size) throw invalid();
				total += body.byteLength + type.length * 2 + (typeof name === 'string' ? name.length * 2 : 0);
				if (total > LIMITS.maximumBytes) throw new RangeError('Desktop Photo clone exceeds its host byte capacity.');
				bytes.push(body); const part = Uint8Array.from(body);
				try {
					let blob: Blob;
					if (kind === 'blob') { if (name !== null || modified !== null) throw invalid(); blob = new Blob([part], { type }); }
					else {
						if (typeof name !== 'string' || typeof modified !== 'number' || !Number.isFinite(modified) || typeof File === 'undefined') throw invalid();
						const file = new File([part], name, { type, lastModified: modified });
						if (file.name !== name || !Object.is(file.lastModified, modified)) throw invalid(); blob = file;
					}
					if (blob.type !== type || blob.size !== size) throw invalid(); hosts.set(placeholder, blob);
				} finally { part.fill(0); }
			}
			const graph = transform(field(captured, 'value', 'desktop Photo clone'), hosts, total);
			return Promise.resolve(graph.value);
		} finally { for (const body of bytes) body.fill(0); }
	} catch (error) { return Promise.reject(error); }
}

/** Sender-only cleanup after the actual transport has copied/joined the wire.
 * A structurally matching foreign object cannot wipe another caller's bytes. */
export function retireDesktopPhotoCloneCurrentV1(wire: unknown): void {
	if (!wire || typeof wire !== 'object') return;
	const buffers = owned.get(wire); if (!buffers) return;
	for (const bytes of buffers) bytes.fill(0); owned.delete(wire);
}
function invalid(): TypeError { return new TypeError('Invalid desktop Photo clone envelope.'); }
