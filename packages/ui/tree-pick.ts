// SPDX-License-Identifier: GPL-3.0-only
// A tick-box tree's logic (AreaPicker.svelte): nodes with children, a search
// over them, and a choice held to a most. Pure, so it is tested without a
// window. My Area is its first user: POTA's programs, their entities, then
// their locations, any of which may be ticked (KI7MT, 2026-10-23).

export interface PickNode { readonly id: string; readonly label: string; readonly children?: readonly PickNode[] }

// The nodes a search leaves: a node whose name or code holds the search, with
// all beneath it; otherwise only those of its children that do, or that hold
// one that does. Empty, everything.
export function visibleNodes(nodes: readonly PickNode[], query: string): readonly PickNode[] {
  const q = query.trim().toLowerCase();
  if (q === '') return nodes;
  const holds = (node: PickNode) => node.label.toLowerCase().includes(q) || node.id.toLowerCase().includes(q);
  const keep = (list: readonly PickNode[]): PickNode[] => list.flatMap(node => {
    if (holds(node)) return [node];
    const children = keep(node.children ?? []);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
  return keep(nodes);
}

// Whether a node, or anything beneath it, is chosen: such a node is shown
// open, so what is chosen is always in view.
export function holdsChoice(node: PickNode, chosen: readonly string[]): boolean {
  return chosen.includes(node.id) || (node.children ?? []).some(child => holdsChoice(child, chosen));
}

// The label of a chosen id, found anywhere in the tree.
export function labelOf(nodes: readonly PickNode[], id: string): string | undefined {
  for (const node of nodes) {
    if (node.id === id) return node.label;
    const found = labelOf(node.children ?? [], id);
    if (found) return found;
  }
  return undefined;
}

// The choice after an item is ticked or unticked: taken out if it was in;
// put in if there is room; otherwise unchanged. Order kept as chosen.
export function toggled(chosen: readonly string[], id: string, most: number): readonly string[] {
  if (chosen.includes(id)) return chosen.filter(entry => entry !== id);
  return chosen.length < most ? [...chosen, id] : chosen;
}
