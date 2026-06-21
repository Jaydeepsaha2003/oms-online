/** User-editable option lists surfaced on the Settings page and used by forms. */

export const SETTING_GROUPS = ['COMPLETION_DAYS', 'ORDER_TYPE'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export interface OrderOptionDto {
  id: number;
  group: string;
  value: string;
  sortOrder: number;
}

export interface OrderOptionInput {
  group: string;
  value: string;
}

export interface SettingGroupMeta {
  group: SettingGroup;
  label: string;
  description: string;
  /** Values are whole numbers (e.g. completion days). */
  numeric: boolean;
  placeholder: string;
}

/** The setting groups the UI knows how to render, in display order. */
export const SETTING_GROUP_META: SettingGroupMeta[] = [
  {
    group: 'COMPLETION_DAYS',
    label: 'Completion Days',
    description: 'Delivery durations (in days) selectable when creating an order.',
    numeric: true,
    placeholder: 'e.g. 7',
  },
  {
    group: 'ORDER_TYPE',
    label: 'Order Types',
    description: 'Order type options available on order line items.',
    numeric: false,
    placeholder: 'e.g. SALES ORDER',
  },
];
