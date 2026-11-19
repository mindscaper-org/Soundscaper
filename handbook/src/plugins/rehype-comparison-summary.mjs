import { createVerdictLedger, rankVerdictColumns, VERDICTS, VERDICT_STATES } from '../comparison/verdict-counts.ts';

const element = (tagName, properties = {}, children = []) => ({ type: 'element', tagName, properties, children });
const text = value => ({ type: 'text', value });
const hasClass = (node, name) => node.properties?.className?.includes(name);
const elements = (node, tag) => (node.children ?? []).filter(child => child.tagName === tag);
const textOf = node => node.type === 'text' ? node.value
	: node.tagName === 'br' || node.type === 'raw' && /^<br\s*\/?>$/iu.test(node.value.trim()) ? ' '
		: (node.children ?? []).map(textOf).join('');

function counter(index) {
	return element('div', { className: ['comparison-counter'], dataComparisonCounter: String(index), hidden: true, role: 'img', ariaLabel: 'Rows passed: 0 supported, 0 limited, 0 unavailable' },
		VERDICT_STATES.map(state => element('span', { className: [`comparison-count--${state}`], ariaHidden: 'true', ...(state === 'unknown' ? { hidden: true } : {}) }, [
			text(`${VERDICTS[state].marker} `), element('span', { dataCount: state }, [text('0')]),
		])));
}

function chart(product, counts) {
	const total = VERDICT_STATES.reduce((sum, state) => sum + counts[state], 0);
	const end = value => `${total ? value / total * 100 : 0}%`;
	const label = `${product.name}: ${counts.yes} supported, ${counts.partial} limited, ${counts.no} unavailable${counts.unknown ? `, ${counts.unknown} not verified` : ''}`;
	return element('figure', { className: ['comparison-chart'], ariaLabel: product.name }, [
		element('figcaption', {}, [text(product.name)]),
		element('div', {
			className: ['comparison-bar'], role: 'img', ariaLabel: label,
			style: `--yes-end: ${end(counts.yes)}; --partial-end: ${end(counts.yes + counts.partial)}; --no-end: ${end(counts.yes + counts.partial + counts.no)}`,
		}),
		element('dl', { className: ['comparison-chart-counts'] }, VERDICT_STATES.filter(state => state !== 'unknown' || counts.unknown).map(state => element('div', {}, [
			element('dt', { className: [`comparison-count--${state}`] }, [text(`${VERDICTS[state].marker} ${VERDICTS[state].label}`)]),
			element('dd', {}, [text(String(counts[state]))]),
		]))),
	]);
}

/** Build the static charts and annotate the same rows for the progressive client counter. */
export default function rehypeComparisonSummary() {
	return tree => {
		const tables = [];
		let placeholder;
		const visit = node => {
			for (const [index, child] of (node.children ?? []).entries()) {
				if (hasClass(child, 'verdict-table')) tables.push(child);
				if (child.type === 'raw' && child.value.trim() === '<!-- comparison-summary -->') placeholder = { parent: node, index };
				visit(child);
			}
		};
		visit(tree);
		if (!tables.length || !placeholder) return;
		const rows = [], products = [];
		for (const table of tables) {
			const header = elements(elements(table, 'thead')[0], 'tr').at(-1);
			const columns = elements(header, 'th');
			if (!products.length) products.push(...columns.map(column => ({ name: textOf(column).trim() })));
			if (columns.length !== products.length || columns.some((column, index) => textOf(column).trim() !== products[index].name)) throw new Error('Comparison product columns differ between tables.');
			for (const row of elements(table, 'tbody').flatMap(body => elements(body, 'tr'))) {
				const cells = row.children.filter(child => child.tagName === 'td' || child.tagName === 'th').slice(1);
				if (cells.length !== products.length) throw new Error('Comparison column count does not match its verdicts.');
				const states = cells.map(cell => {
					const state = VERDICT_STATES.find(state => hasClass(cell, `verdict-cell--${state}`));
					if (!state) throw new Error('Comparison cell is missing a verdict.');
					return state;
				});
				row.properties.dataComparisonVerdicts = states.map(state => VERDICTS[state].marker).join('');
				rows.push(states);
			}
			if (table === tables[0]) columns.forEach((column, index) => column.children.push(counter(index)));
		}
		const totals = createVerdictLedger(rows, products.length).at(-1);
		placeholder.parent.children[placeholder.index] = element('div', { className: ['comparison-summary'], dataComparisonSummary: '', dataComparisonColumns: products.length }, rankVerdictColumns(totals).map(index => chart(products[index], totals[index])));
	};
}
