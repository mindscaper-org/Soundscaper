/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { VIDEO_COLOR_LIMITS_V1 } from '../src/common/editor/cube-lut-reference-contract.ts';
import { normalizeImageDevelopPresetCurrentForProfileV1 } from '../src/common/editor/imaging/internal/image-develop-preset-kernel-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import type { PhotoMediaCubeLutResourcesV1 } from '../src/lightscaper/storage/photo-media-cube-lut-resources-v1.ts';
import type { PhotoMediaMaskRasterResourcesV1 } from '../src/lightscaper/storage/photo-media-mask-raster-resources-v1.ts';
import { openLightscaperNativePhotoResourceDatabaseCurrentV1 } from './lightscaper-native-photo-resources-files-current-v1.ts';
import { LightscaperNativePhotoResourceLifetimeCurrentV1 } from './lightscaper-native-photo-resource-lifetime-current-v1.ts';
import { admitLightscaperNativePhotoResourceReferenceCurrentV1, captureLightscaperNativePhotoResourceBodyCurrentV1,
	authenticateLightscaperNativePhotoResourceBodyCurrentV1, wipeLightscaperNativePhotoResourceBodyCurrentV1,
	type LightscaperNativePhotoResourceFamilyCurrentV1, type LightscaperNativePhotoResourceReferenceCurrentV1 } from './lightscaper-native-photo-resource-body-current-v1.ts';
import { readLightscaperNativePhotoResourceBodyCurrentV1, installLightscaperNativePhotoResourceBodyCurrentV1 } from './lightscaper-native-photo-resource-records-current-v1.ts';
import { readLightscaperNativePhotoLutFileCurrentV1 } from './lightscaper-native-photo-resource-lut-file-current-v1.ts';

type Family = LightscaperNativePhotoResourceFamilyCurrentV1;
type Reference<F extends Family> = Readonly<LightscaperNativePhotoResourceReferenceCurrentV1<F>>;
type Cube = Readonly<Required<PhotoMediaCubeLutResourcesV1>>;
type Brush = Readonly<Required<PhotoMediaMaskRasterResourcesV1>>;
const CHECK = AbortSignal.prototype.throwIfAborted;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;

/** Main-private append-only resources. Render, verify and installation each
 * have one independent slot per family. No Session, renderer or path API is
 * activated; all raw views are borrowed and retired before this owner closes. */
export class LightscaperNativePhotoResourcesCurrentV1 {
	readonly #database: DatabaseSync;
	readonly #lifetime = new LightscaperNativePhotoResourceLifetimeCurrentV1();
	readonly #cube: Cube;
	readonly #brush: Brush;
	private constructor(database: DatabaseSync) {
		this.#database = database;
		this.#cube = Object.freeze<Cube>({
			source: Object.freeze<CubeLutSourcePortV1>({ withBytes: (reference, consume, options) => this.#withBytes('lut', reference, consume, options) }),
			put: (reference, bytes, options) => this.#put('lut', reference, bytes, options),
			importFile: (file, options) => this.#importLut(file, options),
			verifyPhoto: (value, signal) => this.#verify('lut', 'photo', value, signal),
			verifyPreset: (value, signal) => this.#verify('lut', 'preset', value, signal),
			verifyReferencesV1: (value, signal) => this.#verify('lut', 'references', value, signal),
		});
		this.#brush = Object.freeze<Brush>({
			source: Object.freeze<MaskRasterSourcePortV1>({ withBytes: (reference, consume, options) => this.#withBytes('brush', reference, consume, options) }),
			put: (reference, bytes, options) => this.#put('brush', reference, bytes, options),
			verifyPhoto: (value, signal) => this.#verify('brush', 'photo', value, signal),
			verifyPreset: (value, signal) => this.#verify('brush', 'preset', value, signal),
			verifyReferencesV1: (value, signal) => this.#verify('brush', 'references', value, signal),
		});
	}

	static async open(options: Readonly<{ appDataPath: string }>): Promise<LightscaperNativePhotoResourcesCurrentV1> {
		const input = record(options, 'native Photo resource owner', ['appDataPath']);
		const path = field(input, 'appDataPath', 'native Photo resource owner');
		if (typeof path !== 'string') throw new TypeError('Native Photo resources require their main-owned appData directory.');
		const database = await openLightscaperNativePhotoResourceDatabaseCurrentV1(path);
		try { return new LightscaperNativePhotoResourcesCurrentV1(database); }
		catch (primary) {
			try { database.close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Photo resource opening and retirement failed.', { cause: cleanup }); }
			throw primary;
		}
	}

	readonly cubeLutResources = async (): Promise<Cube> => { this.#lifetime.assertAccepting(); return this.#cube; };
	readonly maskRasterResources = async (): Promise<Brush> => { this.#lifetime.assertAccepting(); return this.#brush; };

	close(): Promise<void> { return this.#lifetime.close(() => { this.#database.close(); }); }

	#put<F extends Family>(family: F, reference: unknown, bytes: unknown, options: unknown) {
		return this.#lifetime.run(`${family}:install`, options,
			() => captureLightscaperNativePhotoResourceBodyCurrentV1(family, reference, bytes), async (body, signal) => {
				await authenticateLightscaperNativePhotoResourceBodyCurrentV1(body, signal); check(signal);
				// The synchronous COMMIT receipt owns success. Neither this scope
				// nor its lifetime performs an after-COMMIT cancellation check.
				return installLightscaperNativePhotoResourceBodyCurrentV1(this.#database, body, signal);
			}, wipeLightscaperNativePhotoResourceBodyCurrentV1);
	}

	#importLut(fileValue: Blob, options: unknown) {
		return this.#lifetime.run('lut:install', options, () => {
			const size = Number(Reflect.apply(BLOB_SIZE, fileValue, []));
			if (size < 1 || size > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes) throw new RangeError('Native LUT file exceeds its fixed byte bound.');
			return fileValue;
		}, async (file, signal) => {
			const body = await readLightscaperNativePhotoLutFileCurrentV1(file, signal);
			try {
				await authenticateLightscaperNativePhotoResourceBodyCurrentV1(body, signal); check(signal);
				return installLightscaperNativePhotoResourceBodyCurrentV1(this.#database, body, signal);
			} finally { wipeLightscaperNativePhotoResourceBodyCurrentV1(body); }
		});
	}

	#withBytes<F extends Family, Result>(family: F, referenceValue: unknown,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options: unknown): Promise<Result> {
		return this.#lifetime.run(`${family}:render`, options, () => {
			if (typeof consume !== 'function') throw new TypeError('Native resource reads require a scoped consumer.');
			return admitLightscaperNativePhotoResourceReferenceCurrentV1(family, referenceValue);
		}, async (reference, signal) => {
			const body = readLightscaperNativePhotoResourceBodyCurrentV1(this.#database, family, reference);
			try {
				await authenticateLightscaperNativePhotoResourceBodyCurrentV1(body, signal); check(signal);
				const result = await consume(body.bytes); check(signal); return result;
			} finally { wipeLightscaperNativePhotoResourceBodyCurrentV1(body); }
		});
	}

	#verify<F extends Family>(family: F, kind: 'photo' | 'preset' | 'references', value: unknown, signal?: AbortSignal): Promise<void> {
		return this.#lifetime.run(`${family}:verify`, { signal }, () => this.#references(family, kind, value), async (references, admitted) => {
			for (const reference of references) {
				check(admitted);
				const body = readLightscaperNativePhotoResourceBodyCurrentV1(this.#database, family, reference);
				try { await authenticateLightscaperNativePhotoResourceBodyCurrentV1(body, admitted); }
				finally { wipeLightscaperNativePhotoResourceBodyCurrentV1(body); }
			}
			check(admitted);
		});
	}

	#references<F extends Family>(family: F, kind: 'photo' | 'preset' | 'references', value: unknown): readonly Reference<F>[] {
		if (kind === 'references') return Object.freeze(readClosedDomainArray(value, 'native selected resource references', 0, 4094).map(entry => {
			if (family === 'brush' && typeof entry === 'string') throw new TypeError('Selected brush references require their exact scalar record.');
			return admitLightscaperNativePhotoResourceReferenceCurrentV1(family, entry);
		}));
		const collector = createPhotoResourceReachabilityCurrentV1();
		if (kind === 'photo') collector.addPhoto(value);
		else collector.addDevelop(normalizeImageDevelopPresetCurrentForProfileV1('current4', value, 'selected').settings.develop);
		const closure = collector.finish();
		return (family === 'lut' ? closure.luts : closure.brushes) as readonly Reference<F>[];
	}
}
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
