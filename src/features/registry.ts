export type FeatureId =
  | 'pr-sidebar-metadata'
  | 'pr-file-tree-viewport'
  | 'mermaid-fullscreen'
  | 'pr-handback-assignee'
  | 'pr-people-pins'
  | 'open-in-cursor'
  | 'pr-checkout-branch'
  | 'pr-tab-favicon';

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
    id: 'pr-file-tree-viewport',
    title: 'File tree scroll position',
    description: 'Highlights the files on screen in the changed-files tree.',
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
  {
    id: 'open-in-cursor',
    title: 'Open in Cursor',
    description: 'Open PR lines, review comments, and files in the matching local Cursor window.',
    defaultEnabled: true,
  },
  {
    id: 'pr-checkout-branch',
    title: 'Check out PR branch locally',
    description: 'Check out the head branch in an open Cursor window, from beside the branch name.',
    defaultEnabled: true,
  },
  {
    id: 'pr-tab-favicon',
    title: 'Pull request tab icons',
    description: 'Per-tab favicon for Conversation, Commits, Checks, and Files changed.',
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
