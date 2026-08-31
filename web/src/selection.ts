export type Selection = { type: 'mini' | 'prop'; id: bigint } | null;

export const isSelected = (sel: Selection, type: 'mini' | 'prop', id: bigint): boolean =>
  sel !== null && sel.type === type && sel.id === id;
