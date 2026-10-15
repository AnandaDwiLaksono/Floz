import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pages = [
  'app/page.tsx',
  'app/login/page.tsx',
  'app/join/page.tsx',
  'app/invitations/accept/page.tsx',
  'app/onboarding/page.tsx',
  'app/workspaces/[workspaceId]/dashboard/page.tsx',
  'app/workspaces/[workspaceId]/settings/join/page.tsx',
  'app/workspaces/[workspaceId]/settings/workflows/page.tsx',
  'app/workspaces/[workspaceId]/settings/profile/page.tsx',
  'app/workspaces/[workspaceId]/settings/workspace/page.tsx',
  'app/workspaces/[workspaceId]/settings/teams/page.tsx',
  'components/workflow-create-dialog.tsx',
  'components/workflow-metadata-card.tsx',
  'components/workflow-status-card.tsx',
  'components/task-comments-section.tsx',
];

describe('redesign semantic CSS', () => {
  it.each(pages)('%s uses theme tokens instead of fixed palette utilities', (page) => {
    const source = readFileSync(resolve(process.cwd(), page), 'utf8');
    expect(source).not.toMatch(/(?:^|[\s'"`])(?:dark:|hover:|focus:|focus-visible:)?(?:bg|text|border|ring)-(?:red|rose|orange|yellow|green|emerald|blue|gray|slate|zinc|neutral|purple|white|black)(?:-\d{2,3})?(?:\/[\d.]+)?(?=[\s'"`])/);
    expect(source).not.toMatch(/(?:^|[\s'"`])(?:border-input|ring-ring|(?:bg|text|border)-destructive)(?:\/[\d.]+)?(?=[\s'"`])/);
  });
});
