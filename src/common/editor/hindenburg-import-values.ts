/* SPDX-License-Identifier: AGPL-3.0-only */

import { addRationals, multiplyRationals, normalizeRational, type Rational } from './timeline-time.ts';
import type { XmlElement } from './dawproject-xml.ts';

/** NHSX clocks are seconds, minutes:seconds or hours:minutes:seconds, never frame timecode. */
export function hindenburgTime(value = '0'): Rational {
	const parts = value.split(':');
	if (parts.length > 3 || !parts.every((part, index) =>
		(index === parts.length - 1 ? /^\d+(?:\.\d{1,6})?$/u : /^\d+$/u).test(part)
		&& (index === 0 || Number(part) < 60))) throw new SyntaxError('Invalid Hindenburg clock.');
	let result: Rational = { num: 0, den: 1 };
	for (const part of parts) {
		const [whole = '', fraction = ''] = part.split('.');
		const den = 10 ** fraction.length;
		const num = Number(whole) * den + Number(fraction);
		if (!Number.isSafeInteger(num)) throw new RangeError('Hindenburg clock exceeds the safe integer range.');
		result = addRationals(multiplyRationals(result, 60), { num, den });
	}
	return normalizeRational(result);
}

export function hindenburgRequired(node: XmlElement, key: string): string {
	const value = node.attributes[key];
	if (!value) throw new SyntaxError(`Hindenburg ${node.name} requires ${key}.`);
	return value;
}

export function hindenburgNumber(value: string | undefined, fallback = 0): number {
	if (value === undefined) return fallback;
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value) || !Number.isFinite(Number(value))) {
		throw new RangeError('Hindenburg controls must be finite decimal numbers.');
	}
	return Number(value);
}

export function hindenburgGain(value: string | undefined): number {
	if (value?.toLowerCase() === '-inf') return 0;
	const gain = 10 ** (hindenburgNumber(value) / 20);
	if (!Number.isFinite(gain)) throw new RangeError('Hindenburg gain exceeds the supported range.');
	return gain;
}

export function hindenburgFlag(value: string | undefined): boolean {
	if (value === undefined || /^(?:false|0)$/iu.test(value)) return false;
	if (/^(?:true|1)$/iu.test(value)) return true;
	throw new SyntaxError('Invalid Hindenburg boolean control.');
}

/** Only relative members enter the existing owner-scoped desktop media resolver. */
export function hindenburgMediaPath(value: string): string {
	if (!value) return '';
	const parts = value.replaceAll('\\', '/').split('/');
	if (value.length > 4096 || parts.length > 32 || parts.some(part => !part || part === '.' || part === '..'
		|| part.length > 255 || part.includes(':') || Array.from(part).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) {
		throw new SyntaxError('Hindenburg media path must be a bounded relative path.');
	}
	return parts.join('/');
}

export function hindenburgChild(node: XmlElement, name: string, required = false): XmlElement | null {
	const children = node.children.filter(child => child.name === name);
	if (children.length > 1 || (required && !children.length)) throw new SyntaxError(`Hindenburg requires one ${name} element.`);
	return children[0] ?? null;
}

export function hindenburgLocalNames(node: XmlElement): XmlElement {
	return { ...node, name: node.name.split(':').at(-1)!,
		attributes: Object.fromEntries(Object.entries(node.attributes).filter(([key]) => !/^xmlns(?::|$)/u.test(key))),
		children: node.children.map(hindenburgLocalNames) };
}
