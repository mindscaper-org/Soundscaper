const textOf = (node) => node.type === 'text' ? node.value : (node.children ?? []).map(textOf).join('');

function visit(parent) {
	if (parent.properties?.className?.includes('comparison-table-scroll')) return;
	let label = 'Comparison table';
	for (const [index, child] of (parent.children ?? []).entries()) {
		if (child.type === 'element' && /^h[1-6]$/u.test(child.tagName)) label = textOf(child);
		visit(child);
		if (child.tagName !== 'table' || !child.properties?.className?.includes('verdict-table')) continue;
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

export default function rehypeComparisonLayout() {
	return visit;
}
