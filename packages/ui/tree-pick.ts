// SPDX-License-Identifier: GPL-3.0-only
// A tick-box tree's logic (AreaPicker.svelte): groups of items, a search
// over them, and a choice held to a most. Pure, so it is tested without a
// window. My Area is its first user: programs, then their locations.

export interface PickItem { readonly id: string; readonly label: string }
export interface PickGroup { readonly id: string; readonly label: string; readonly items: readonly PickItem[] }

// The groups a search leaves: an item whose name or code holds the search,
// or every item of a group whose name does. Empty, everything.
export function visibleGroups(groups: readonly PickGroup[], query: string): readonly PickGroup[] {
  const q = query.trim().toLowerCase();
  if (q === '') return groups;
  const holds = (text: string) => text.toLowerCase().includes(q);
  return groups.flatMap(group => {
    if (holds(group.label) || holds(group.id)) return [group];
    const items = group.items.filter(item => holds(item.label) || holds(item.id));
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

// The choice after an item is ticked or unticked: taken out if it was in;
// put in if there is room; otherwise unchanged. Order kept as chosen.
export function toggled(chosen: readonly string[], id: string, most: number): readonly string[] {
  if (chosen.includes(id)) return chosen.filter(entry => entry !== id);
  return chosen.length < most ? [...chosen, id] : chosen;
}
