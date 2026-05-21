import type { SessionIndex } from './domain/session';

export const demoSessionIndex: SessionIndex = {
  generatedAt: '2026-05-21T00:00:00.000Z',
  groups: [
    {
      slug: '~-Work-launch-plan',
      title: '~/Work/launch/plan',
      cwd: '~/Work/launch-plan',
      pages: [],
      sessions: [{ id: 'demo-pi-1', cwd: '~/Work/launch-plan', updatedAt: '2026-05-21T10:30:00.000Z', kind: 'pi', projectName: 'launch-plan', title: 'Compare launch options', source: 'demo' }],
    },
    {
      slug: '~-Work-product-ui',
      title: '~/Work/product/ui',
      cwd: '~/Work/product-ui',
      pages: [],
      sessions: [{ id: 'demo-claude-1', cwd: '~/Work/product-ui', updatedAt: '2026-05-21T09:45:00.000Z', kind: 'claude', projectName: 'product-ui', title: 'Review onboarding flow', source: 'demo' }],
    },

    {
      slug: '~-Work-demo',
      title: '~/Work/demo',
      cwd: '~/Work/demo',
      pages: [],
      sessions: [{ id: 'demo-codex-1', cwd: '~/Work/demo', updatedAt: '2026-05-21T11:15:00.000Z', kind: 'codex', projectName: 'demo', title: 'Prototype interactive artifacts', source: 'demo' }],
    },
  ],
};
