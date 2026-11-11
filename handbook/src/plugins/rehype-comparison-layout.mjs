const textOf = (node) => node.type === 'text' ? node.value : (node.children ?? []).map(textOf).join('');

const element = (tagName, properties, children = []) => ({ type: 'element', tagName, properties, children });

function addClasses(node, ...classes) {
	node.properties ??= {};
	node.properties.className = [...(node.properties.className ?? []), ...classes];
}

function groupColumns(table, groups) {
	if (!groups.length || table.properties.className.includes('comparison-table--grouped')) return;
	const head = table.children.find((child) => child.tagName === 'thead');
	const header = head?.children.find((child) => child.tagName === 'tr');
	if (!header) return;
	const [feature, ...products] = header.children.filter((child) => child.tagName === 'th');
	const columns = groups.flatMap((group, category) => group.families.flatMap((family, familyIndex) => family.map((name, index) => ({
		name, related: family.length > 1, familyStart: index === 0, categoryStart: category > 0 && familyIndex === 0 && index === 0,
	}))));
	if (products.length !== columns.length || products.some((cell, index) => {
		const name = textOf(cell);
		return name !== columns[index].name && !name.startsWith(`${columns[index].name} `);
	})) {
		throw new Error('Comparison product headers do not match the configured column groups.');
	}

	addClasses(table, 'comparison-table--grouped');
	table.properties.style = `--comparison-product-count: ${products.length}`;
	feature.properties = { ...feature.properties, rowSpan: 2, scope: 'col' };
	addClasses(feature, 'comparison-feature-heading');
	for (const [index, product] of products.entries()) {
		product.properties.scope = 'col';
		if (columns[index].related) addClasses(product, 'comparison-family-related');
	}
	const categories = groups.map((group, index) => element('th', {
		scope: 'colgroup', colSpan: group.families.flat().length,
		className: ['comparison-category-heading', ...(index > 0 ? ['comparison-category-start'] : [])],
	}, [element('span', { className: ['comparison-category-label'] }, [{ type: 'text', value: group.label }])]));
	head.children = [element('tr', {}, [feature, ...categories]), element('tr', {}, products)];

	const bodies = table.children.filter((child) => child.tagName === 'tbody');
	const bodyRows = bodies.flatMap((body) => body.children.filter((child) => child.tagName === 'tr'));
	const rows = [products, ...bodyRows.map((row) => {
		const cells = row.children.filter((child) => child.tagName === 'td' || child.tagName === 'th');
		cells[0].tagName = 'th';
		cells[0].properties.scope = 'row';
		addClasses(cells[0], 'comparison-feature-heading');
		return cells.slice(1);
	})];
	for (const row of rows) {
		for (const [index, cell] of row.entries()) {
			if (columns[index].familyStart) addClasses(cell, 'comparison-family-start');
			if (columns[index].categoryStart) addClasses(cell, 'comparison-category-start');
		}
	}
	table.children.unshift(
		element('colgroup', {}, [element('col', { className: ['comparison-feature-column'] })]),
		...groups.map((group) => element('colgroup', {}, [element('col', { span: group.families.flat().length })])),
	);
}

function visit(parent, groups) {
	if (parent.properties?.className?.includes('comparison-table-scroll')) return;
	let label = 'Comparison table';
	for (const [index, child] of (parent.children ?? []).entries()) {
		if (child.type === 'element' && /^h[1-6]$/u.test(child.tagName)) label = textOf(child);
		visit(child, groups);
		if (child.tagName !== 'table' || !child.properties?.className?.includes('verdict-table')) continue;
		groupColumns(child, groups);
		// The scroll region owns keyboard focus; the nested table keeps its
		// native semantics and can use a fixed layout independently of overflow.
		delete child.properties.tabIndex;
		parent.children[index] = {
			type: 'element',
			tagName: 'div',
			properties: { className: ['comparison-table-scroll'], role: 'region', ariaLabel: label, tabIndex: 0 },
			children: [child],
		};
	}
}

export default function rehypeComparisonLayout({ groups = [] } = {}) {
	return (tree) => visit(tree, groups);
}
