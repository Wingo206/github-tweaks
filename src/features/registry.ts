export type FeatureId =
  | 'pr-sidebar-metadata'
  | 'mermaid-fullscreen'
  | 'pr-handback-assignee'
  | 'pr-people-pins';

export interface FeatureDefinition {
  id: FeatureId;
  title: string;
  description: string;
  defaultEnabled: boolean;
}

export type FeatureFlags = Record<FeatureId, boolean>;

export const FEATURES: readonly FeatureDefinition[] = [
  {
    id: 'pr-sidebar-metadata',
    title: 'Pull request sidebar metadata',
    description: 'Line counts, Viewed state, and progress in the changed-files tree.',
    defaultEnabled: true,
  },
  {
    id: 'mermaid-fullscreen',
    title: 'Mermaid fullscreen viewer',
    description: 'Pan and zoom modal for rendered Mermaid diagrams.',
    defaultEnabled: true,
  },
  {
    id: 'pr-handback-assignee',
    title: 'Hand back PR assignee',
    description: 'One-click “reassign author” action beside Assignees.',
    defaultEnabled: true,
  },
  {
    id: 'pr-people-pins',
    title: 'Pinned people',
    description: 'Per-repository pins in the Reviewers and Assignees menus.',
    defaultEnabled: true,
  },
];

export function resolveFeatureFlags(stored: unknown): FeatureFlags {
  const overrides =
    stored && typeof stored === 'object'
      ? (stored as Partial<Record<string, unknown>>)
      : {};
  const flags = {} as FeatureFlags;

  for (const feature of FEATURES) {
    const override = overrides[feature.id];
    flags[feature.id] =
      typeof override === 'boolean' ? override : feature.defaultEnabled;
  }

  return flags;
}
