// In a verdict cell, `summary :: explanation` keeps the explanation in a
// tooltip. Splitting text nodes preserves code and other inline formatting.
function addDetail(cell, id) {
	const index = cell.children.findIndex((node) => node.type === 'text' && node.value.includes(' :: '));
	if (index < 0) return;
	const node = cell.children[index];
	const split = node.value.indexOf(' :: ');
	const summary = [...cell.children.slice(0, index), { type: 'text', value: node.value.slice(0, split) }];
	const detail = [{ type: 'text', value: node.value.slice(split + 4) }, ...cell.children.slice(index + 1)];
	cell.children = [{
		type: 'element',
		tagName: 'comparison-note',
		properties: {},
		children: [{
			type: 'element',
			tagName: 'button',
			properties: { type: 'button', className: ['comparison-note-trigger'], ariaDescribedBy: id },
			children: summary,
		}, {
			type: 'element',
			tagName: 'span',
			properties: { id, role: 'tooltip', popover: 'auto', className: ['comparison-note-detail'] },
			children: detail,
		}],
	}];
}

export default function rehypeComparisonDetails() {
	return (tree) => {
		let count = 0;
		const visit = (node) => {
			if (node.type === 'element' && node.properties?.className?.includes('verdict-cell')) {
				addDetail(node, `comparison-detail-${++count}`);
				return;
			}
			for (const child of node.children ?? []) visit(child);
		};
		visit(tree);
	};
}
