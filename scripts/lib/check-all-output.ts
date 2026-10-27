/* SPDX-License-Identifier: AGPL-3.0-only */

import { stripVTControlCharacters } from 'node:util';
import { StringDecoder } from 'node:string_decoder';

import type { CheckState } from './check-all-scheduler.ts';

export type CheckProgress =
	| { type: 'start'; id: string; label: string }
	| { type: 'end'; id: string; failure?: string };

const PREFIX = 'SCAPE_CHECK_ALL ';
const MAX_LINE = 65_536;

export function progressRecord(event: CheckProgress): string {
	const bounded = { ...event };
	// Assertion diffs can span megabytes. Keep their progress records inside
	// the reader's bound so a large failure is still displayed immediately.
	const field = bounded.type === 'start' ? 'label' : 'failure';
	const original = event.type === 'start' ? event.label : event.failure;
	let limit = 8_192;
	if (original !== undefined) {
		while (true) {
			Object.assign(bounded, { [field]: original.length > limit ? `${original.slice(0, limit)}\n[diagnostic truncated]` : original });
			if (JSON.stringify(bounded).length + PREFIX.length + 1 <= MAX_LINE || limit === 0) break;
			limit = Math.floor(limit / 2);
		}
	}
	return `${PREFIX}${JSON.stringify(bounded)}\n`;
}

export function createCheckOutputReader(onProgress: (event: CheckProgress) => void, onLine?: (line: string) => void) {
	const decoder = new StringDecoder('utf8');
	let pending = '';
	let oversized = false;
	const line = (): void => {
		if (!oversized) {
			let event: unknown;
			if (pending.startsWith(PREFIX)) {
				try { event = JSON.parse(pending.slice(PREFIX.length)); } catch { /* Ordinary output. */ }
			}
			if (isProgress(event)) onProgress(event);
			else onLine?.(pending);
		}
		pending = '';
		oversized = false;
	};
	const consume = (text: string): void => {
		for (const part of text.split(/(?<=\n)/u)) {
			if (!oversized) {
				if (pending.length + part.length > MAX_LINE) oversized = true;
				else pending += part;
			}
			if (part.endsWith('\n')) line();
		}
	};
	return {
		write(chunk: Uint8Array | string): void { consume(typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk))); },
		finish(): void { consume(decoder.end()); if (pending || oversized) line(); },
	};
}

function isProgress(event: unknown): event is CheckProgress {
	if (!event || typeof event !== 'object' || !('id' in event) || typeof event.id !== 'string' || !('type' in event)) return false;
	return event.type === 'start' ? 'label' in event && typeof event.label === 'string'
		: event.type === 'end' && (!('failure' in event) || typeof event.failure === 'string');
}

interface Output {
	write(text: string): unknown;
	isTTY?: boolean;
	columns?: number;
}

/** Passing test records update the display only; failures become permanent output. */
export class CheckAllDisplay {
	private statuses: ReadonlyMap<string, CheckState> = new Map();
	private readonly active = new Map<string, Map<string, string>>();
	private readonly completed = new Map<string, number>();
	private lines = 0;
	private lastPlain = '';
	private readonly output: Output;
	private readonly total: number;

	constructor(output: Output, total: number) { this.output = output; this.total = total; }

	states(states: ReadonlyMap<string, CheckState>): void { this.statuses = new Map(states); }

	event(task: string, event: CheckProgress): void {
		const active = this.active.get(task) ?? new Map<string, string>();
		this.active.set(task, active);
		if (event.type === 'start') active.set(event.id, clean(event.label));
		else {
			active.delete(event.id);
			this.completed.set(task, (this.completed.get(task) ?? 0) + 1);
			if (event.failure) this.failure(task, event.failure);
		}
	}

	failure(task: string, detail: string): void {
		this.clear();
		this.output.write(`FAIL ${clean(task)}: ${stripVTControlCharacters(detail)}\n`);
	}

	diagnostic(task: string, detail: string): void {
		if (/\b(?:error|failed|fatal)\b|^not ok/iu.test(detail)) this.failure(task, detail);
		else {
			this.clear();
			this.output.write(`${clean(task)}: ${stripVTControlCharacters(detail)}\n`);
		}
	}

	render(): void {
		const states = [...this.statuses.values()];
		const done = states.filter(state => ['passed', 'failed', 'blocked'].includes(state)).length;
		const failed = states.filter(state => state === 'failed').length;
		const blocked = states.filter(state => state === 'blocked').length;
		const filled = this.total === 0 ? 20 : Math.floor(20 * done / this.total);
		const lines = [`[${'#'.repeat(filled)}${'-'.repeat(20 - filled)}] ${done}/${this.total} checks | ${failed} failed | ${blocked} blocked`];
		for (const [id, state] of this.statuses) {
			if (state !== 'running') continue;
			const active = [...(this.active.get(id)?.values() ?? [])];
			lines.push(`${id}: ${this.completed.get(id) ?? 0} completed | ${active.slice(-2).join('; ') || 'working'}${active.length > 2 ? ` (+${active.length - 2})` : ''}`);
		}
		const text = lines.map(line => line.slice(0, Math.max(20, (this.output.columns ?? 120) - 1))).join('\n');
		if (!this.output.isTTY && text === this.lastPlain) return;
		this.clear();
		this.output.write(`${text}\n`);
		this.lines = this.output.isTTY ? lines.length : 0;
		this.lastPlain = text;
	}

	finish(): void { this.render(); this.lines = 0; }

	private clear(): void {
		if (this.lines > 0) this.output.write(`\u001b[${this.lines}A\u001b[0J`);
		this.lines = 0;
	}
}

function clean(text: string): string {
	return stripVTControlCharacters(text).replace(/[\r\n\t]/gu, ' ');
}
