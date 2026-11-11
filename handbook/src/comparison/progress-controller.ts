import { createVerdictLedger, parseVerdictRow, passedRowCount, VERDICT_STATES, type VerdictCounts } from './verdict-counts.ts';

interface Section {
	readonly table: HTMLTableElement;
	readonly scroll: HTMLElement;
	readonly head: HTMLTableSectionElement;
	top: number;
	bottom: number;
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
	const sections: Section[] = [...root.querySelectorAll<HTMLTableElement>('table.comparison-table--grouped')].map(table => ({
		table, scroll: table.parentElement!, head: table.tHead!, top: 0, bottom: 0, height: 0, left: 0, width: 0, tableWidth: 0,
	}));
	if (!sections.length) return () => {};
	const pinned = document.createElement('div');
	pinned.className = 'sl-markdown-content comparison-sticky-header';
	pinned.setAttribute('aria-hidden', 'true');
	pinned.hidden = true;
	const scroll = document.createElement('div');
	scroll.className = 'comparison-table-scroll';
	pinned.append(scroll);
	document.body.append(pinned);

	const events = new AbortController();
	const options = { signal: events.signal, passive: true };
	let bottoms: number[] = [], top = 0, frame = 0, dirty = true, active: Section | undefined;
	let clone: HTMLTableElement | undefined, pinnedCounters: Counter[] = [], passed = -1, horizontal = 0;
	const measure = () => {
		const navbar = document.querySelector<HTMLElement>('.page > header')?.getBoundingClientRect();
		const toc = document.querySelector<HTMLElement>('mobile-starlight-toc summary')?.getBoundingClientRect();
		top = Math.max(navbar?.bottom ?? 0, toc?.height ? toc.bottom : 0);
		for (const section of sections) {
			const table = section.table.getBoundingClientRect(), container = section.scroll.getBoundingClientRect();
			section.top = section.head.getBoundingClientRect().top + window.scrollY;
			section.bottom = table.bottom + window.scrollY;
			section.height = section.head.getBoundingClientRect().height;
			section.left = container.left;
			section.width = container.width;
			section.tableWidth = table.width;
		}
		bottoms = rows.map(row => row.getBoundingClientRect().bottom + window.scrollY);
	};
	const update = () => {
		frame = 0;
		if (dirty) { measure(); dirty = false; }
		const y = window.scrollY;
		const section = sections.find(section => section.top < y + top && section.bottom > y + top);
		const changed = section !== active;
		if (changed) {
			active = section;
			pinnedCounters = [];
			if (section) {
				clone = section.table.cloneNode(false) as HTMLTableElement;
				for (const child of section.table.children) if (child.tagName === 'COLGROUP' || child.tagName === 'THEAD') clone.append(child.cloneNode(true));
				for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id');
				scroll.replaceChildren(clone);
				pinned.dataset.section = section.scroll.getAttribute('aria-label') ?? '';
				pinnedCounters = countersIn(clone);
			}
		}
		pinned.hidden = !section;
		if (section && clone) {
			pinned.style.top = `${top}px`;
			pinned.style.left = `${section.left}px`;
			pinned.style.width = `${section.width}px`;
			pinned.style.height = `${Math.min(section.height, section.bottom - y - top)}px`;
			clone.style.inlineSize = `${section.tableWidth}px`;
			if (Math.abs(scroll.scrollLeft - horizontal) > 1) scroll.scrollLeft = horizontal;
		}
		const next = passedRowCount(bottoms, y + top + (section?.height ?? sections[0]!.height));
		if (next !== passed || changed) {
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
		for (const section of sections) if (Math.abs(section.scroll.scrollLeft - value) > 1) section.scroll.scrollLeft = value;
		schedule();
	};
	for (const section of sections) section.scroll.addEventListener('scroll', () => synchronize(section.scroll.scrollLeft), options);
	scroll.addEventListener('scroll', () => synchronize(scroll.scrollLeft), options);
	window.addEventListener('scroll', () => schedule(), options);
	window.addEventListener('resize', () => schedule(true), options);
	window.addEventListener('pageshow', () => schedule(true), options);
	const observer = new ResizeObserver(() => schedule(true));
	for (const section of sections) observer.observe(section.table);
	const article = root.querySelector('.sl-markdown-content');
	if (article) observer.observe(article);
	schedule(true);
	return () => {
		events.abort();
		observer.disconnect();
		cancelAnimationFrame(frame);
		pinned.remove();
	};
}
