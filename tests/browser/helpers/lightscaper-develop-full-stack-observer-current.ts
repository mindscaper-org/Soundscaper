/* SPDX-License-Identifier: AGPL-3.0-only */
import { fullStackRetiredCurrentV1 as retired } from './lightscaper-develop-full-stack-scene-current.ts';

/** Transparent native observations. No shader, GL result, capability or
 * expected pixel is substituted. Inventories retain at most one tiny render. */
export function observeFullStackGpuCurrentV1(expectedLength = 0) {
	if (!Number.isSafeInteger(expectedLength) || expectedLength < 0 || expectedLength > 128 * 128 * 4) throw new RangeError('Full-stack observation exceeds its bounded fixture.');
	let finalCopy: Float32Array<ArrayBuffer> | undefined;
	const restores: (() => void)[] = [], handles = new Set<object>(), backings = new Set<ArrayBuffer>();
	const readbacks = new Set<ArrayBuffer>(), renderers = new Set<string>(), uniforms = new Map<object, string>();
	const kinds = new Set<number>(), optics = new Set<number>(), spatial = new Set<number>();
	let draws = 0, reads = 0, floatUploads = 0;
	const patch = (key: string, observe: (gl: WebGL2RenderingContext, args: unknown[], result: unknown) => void) => {
		let owner: object | null = WebGL2RenderingContext.prototype;
		while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) throw new TypeError(`Full-stack observation requires native ${key}.`);
		const target = owner, property = Object.getOwnPropertyDescriptor(target, key)!;
		if (typeof property.value !== 'function') throw new TypeError(`Full-stack native ${key} is not callable.`);
		const method = property.value as (...args: unknown[]) => unknown;
		restores.push(() => { Object.defineProperty(target, key, property); });
		Object.defineProperty(target, key, { ...property, value: function(this: WebGL2RenderingContext, ...args: unknown[]) {
			const result = Reflect.apply(method, this, args); observe(this, args, result); return result;
		} });
	};
	try {
		for (const [create, remove] of [['createTexture', 'deleteTexture'], ['createShader', 'deleteShader'], ['createProgram', 'deleteProgram'],
			['createFramebuffer', 'deleteFramebuffer'], ['createVertexArray', 'deleteVertexArray'], ['createBuffer', 'deleteBuffer'], ['fenceSync', 'deleteSync']] as const) {
			patch(create, (gl, _args, result) => {
				if (result && typeof result === 'object') handles.add(result);
				const debug = gl.getExtension('WEBGL_debug_renderer_info'); renderers.add(String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
			});
			patch(remove, (_gl, args) => { if (args[0] && typeof args[0] === 'object') handles.delete(args[0]); });
		}
		patch('getUniformLocation', (_gl, args, result) => { if (result && typeof result === 'object' && typeof args[1] === 'string') uniforms.set(result, args[1]); });
		patch('uniform1i', (_gl, args) => {
			const name = args[0] && typeof args[0] === 'object' ? uniforms.get(args[0]) : undefined;
			if (name === 'uKind') kinds.add(Number(args[1]));
			if (name === 'uOpticsKind') optics.add(Number(args[1]));
			if (name === 'uSpatialKind') spatial.add(Number(args[1]));
		});
		for (const key of ['drawArrays', 'drawElements']) patch(key, () => { draws++; });
		for (const key of ['texImage2D', 'texImage3D']) patch(key, (_gl, args) => {
			for (const value of args) if (value instanceof Float32Array) {
				if (!(value.buffer instanceof ArrayBuffer)) throw new TypeError('Native upload lost private backing.');
				backings.add(value.buffer); floatUploads++;
			}
		});
		patch('readPixels', (_gl, args) => {
			const value = args[6];
			if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) { backings.add(value.buffer); reads++; }
			if (value instanceof Float32Array && value.buffer instanceof ArrayBuffer) readbacks.add(value.buffer);
			if (value instanceof Float32Array && value.length === expectedLength && Number(args[2]) * Number(args[3]) * 4 === expectedLength) { finalCopy?.fill(0); finalCopy = value.slice(); }
		});
		return {
			compareFinal: (expected: Float32Array<ArrayBuffer>) => finalCopy ? compareFullStackCurrentV1(expected, finalCopy) : null,
			isReadback: (backing: ArrayBuffer) => readbacks.has(backing),
			read: () => ({ alive: handles.size, nativeScratchRetired: [...backings].every(retired), renderers: [...renderers],
				draws, reads, floatUploads, kinds: [...kinds], optics: [...optics], spatial: [...spatial] }),
			close() { finalCopy?.fill(0); for (const restore of restores.reverse()) restore(); restores.length = 0; },
		};
	} catch (error) { for (const restore of restores.reverse()) restore(); throw error; }
}

/** Independent bit-rank oracle: no production numeric comparator is called.
 * Exact alpha/zero/tiny rules and eight-ULP normal RGB contract are checked
 * across the whole output; only bounded mismatch diagnostics escape. */
export function compareFullStackCurrentV1(expected: Float32Array<ArrayBuffer>, actual: Float32Array<ArrayBuffer>, exact = false) {
	if (expected.length !== actual.length) throw new RangeError('Whole-stack output extent differs from its CPU oracle.');
	const left = new Uint32Array(expected.buffer, expected.byteOffset, expected.length), right = new Uint32Array(actual.buffer, actual.byteOffset, actual.length);
	const rank = (word: number) => word >= 0x80000000 ? 0x100000000 - word : 0x80000000 + word;
	let mismatches = 0, maximumUlps = 0;
	const first: { index: number; expected: number; actual: number; ulps: number }[] = [];
	for (let at = 0; at < left.length; at++) {
		const distance = Math.abs(rank(left[at]!) - rank(right[at]!)); maximumUlps = Math.max(maximumUlps, distance);
		const strict = exact || at % 4 === 3 || expected[at] === 0 || Math.abs(expected[at]!) < 2 ** -60;
		if (!Number.isFinite(actual[at]) || (strict ? left[at] !== right[at] : distance > 8)) {
			mismatches++; if (first.length < 6) first.push({ index: at, expected: left[at]!, actual: right[at]!, ulps: distance });
		}
	}
	return { samples: left.length, mismatches, maximumUlps, first };
}
