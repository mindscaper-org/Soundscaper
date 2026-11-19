import { createVerdictLedger, parseVerdictRow, passedRowCount, VERDICT_STATES, type VerdictCounts } from './verdict-counts.ts';

interface SharedHeader {
	readonly table: HTMLTableElement;
	readonly scroll: HTMLElement;
	readonly head: HTMLTableSectionElement;
	top: number;
	height: number;
	left: number;
	width: number;
	tableWidth: number;
}

interface Counter {
	readonly element: HTMLElement;
	readonly column: number;
	readonly values: readonly HTMLElement[];
}

const countersIn = (root: ParentNode): Counter[] => [...root.querySelectorAll<HTMLElement>('[data-comparison-counter]')].map(element => ({
	element, column: Number(element.dataset.comparisonCounter), values: [...element.querySelectorAll<HTMLElement>('[data-count]')],
}));

function updateCounters(counters: readonly Counter[], counts: readonly VerdictCounts[]) {
	for (const { element, column, values } of counters) {
		const count = counts[column]!;
		const total = VERDICT_STATES.reduce((sum, state) => sum + count[state], 0);
		for (const value of values) {
			const state = value.dataset.count as keyof VerdictCounts;
			const next = String(count[state]);
			if (value.textContent !== next) value.textContent = next;
			if (state === 'unknown') value.parentElement!.hidden = count.unknown === 0;
		}
		element.hidden = false;
		element.setAttribute('aria-label', `Rows passed: ${count.yes} supported, ${count.partial} limited, ${count.no} unavailable${count.unknown ? `, ${count.unknown} not verified` : ''}`);
		element.style.setProperty('--yes-end', `${total ? count.yes / total * 100 : 0}%`);
		element.style.setProperty('--partial-end', `${total ? (count.yes + count.partial) / total * 100 : 0}%`);
		element.style.setProperty('--no-end', `${total ? (count.yes + count.partial + count.no) / total * 100 : 0}%`);
	}
}

/** Horizontal overflow prevents CSS table headers from sticking to the page viewport. */
export function installComparisonProgress(root: ParentNode = document): () => void {
	const summary = root.querySelector<HTMLElement>('[data-comparison-summary]');
	if (!summary) return () => {};
	const columns = Number(summary.dataset.comparisonColumns);
	const rows = [...root.querySelectorAll<HTMLTableRowElement>('tr[data-comparison-verdicts]')];
	const ledger = createVerdictLedger(rows.map(row => parseVerdictRow(row.dataset.comparisonVerdicts!, columns)), columns);
	const counters = countersIn(root);
	updateCounters(counters, ledger[0]!);
	const tables = [...root.querySelectorAll<HTMLTableElement>('table.comparison-table--grouped')];
	const first = tables[0];
	if (!first) return () => {};
	const header: SharedHeader = { table: first, scroll: first.parentElement!, head: first.tHead!, top: 0, height: 0, left: 0, width: 0, tableWidth: 0 };
	// Keep later column headers available to assistive technology without repeating them visually.
	for (const table of tables.slice(1)) table.classList.add('comparison-shared-head');
	const pinned = document.createElement('div');
	pinned.className = 'sl-markdown-content comparison-sticky-header';
	pinned.setAttribute('aria-hidden', 'true');
	pinned.hidden = true;
	const scroll = document.createElement('div');
	scroll.className = 'comparison-table-scroll';
	const clone = first.cloneNode(false) as HTMLTableElement;
	for (const child of first.children) if (child.tagName === 'COLGROUP' || child.tagName === 'THEAD') clone.append(child.cloneNode(true));
	for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id');
	scroll.append(clone);
	pinned.append(scroll);
	document.body.append(pinned);
	const pinnedCounters = countersIn(clone);
	const article = root.querySelector<HTMLElement>('.sl-markdown-content');
	article?.classList.add('comparison-global-headings');

	const events = new AbortController();
	const options = { signal: events.signal, passive: true };
	let bottoms: number[] = [], top = 0, frame = 0, dirty = true, passed = -1, horizontal = 0;
	const measure = () => {
		const navbar = document.querySelector<HTMLElement>('.page > header')?.getBoundingClientRect();
		const toc = document.querySelector<HTMLElement>('mobile-starlight-toc summary')?.getBoundingClientRect();
		top = Math.max(navbar?.bottom ?? 0, toc?.height ? toc.bottom : 0);
		const table = header.table.getBoundingClientRect(), container = header.scroll.getBoundingClientRect();
		header.top = header.head.getBoundingClientRect().top + window.scrollY;
		header.height = header.head.getBoundingClientRect().height;
		header.left = container.left;
		header.width = container.width;
		header.tableWidth = table.width;
		article?.style.setProperty('--comparison-scroll-offset', `${top + header.height + 16}px`);
		bottoms = rows.map(row => row.getBoundingClientRect().bottom + window.scrollY);
	};
	const update = () => {
		frame = 0;
		if (dirty) { measure(); dirty = false; }
		const y = window.scrollY;
		pinned.hidden = header.top >= y + top;
		if (!pinned.hidden) {
			pinned.style.top = `${top}px`;
			pinned.style.left = `${header.left}px`;
			pinned.style.width = `${header.width}px`;
			pinned.style.height = `${header.height}px`;
			clone.style.inlineSize = `${header.tableWidth}px`;
			if (Math.abs(scroll.scrollLeft - horizontal) > 1) scroll.scrollLeft = horizontal;
		}
		const next = passedRowCount(bottoms, y + top + header.height);
		if (next !== passed) {
			passed = next;
			updateCounters([...counters, ...pinnedCounters], ledger[passed]!);
		}
	};
	const schedule = (layout = false) => {
		dirty ||= layout;
		if (!frame) frame = requestAnimationFrame(update);
	};
	const synchronize = (value: number) => {
		if (Math.abs(horizontal - value) < 1) return;
		horizontal = value;
		for (const table of tables) if (Math.abs(table.parentElement!.scrollLeft - value) > 1) table.parentElement!.scrollLeft = value;
		schedule();
	};
	for (const table of tables) table.parentElement!.addEventListener('scroll', () => synchronize(table.parentElement!.scrollLeft), options);
	scroll.addEventListener('scroll', () => synchronize(scroll.scrollLeft), options);
	window.addEventListener('scroll', () => schedule(), options);
	window.addEventListener('resize', () => schedule(true), options);
	window.addEventListener('pageshow', () => schedule(true), options);
	const observer = new ResizeObserver(() => schedule(true));
	for (const table of tables) observer.observe(table);
	if (article) observer.observe(article);
	schedule(true);
	return () => {
		events.abort();
		observer.disconnect();
		cancelAnimationFrame(frame);
		pinned.remove();
		article?.classList.remove('comparison-global-headings');
		article?.style.removeProperty('--comparison-scroll-offset');
		for (const table of tables.slice(1)) table.classList.remove('comparison-shared-head');
	};
}
