import type { SessionIndex } from './domain/session';

export const demoSessionIndex: SessionIndex = {
  generatedAt: '2026-05-21T00:00:00.000Z',
  groups: [
    {
      slug: '~-Work-artifacts',
      title: '~/Work/artifacts',
      cwd: '~/Work/artifacts',
      pages: [],
      sessions: [
        { id: 'demo-pi-artifacts', cwd: '~/Work/artifacts', updatedAt: '2026-05-21T11:30:00.000Z', kind: 'pi', projectName: 'artifacts', title: 'Prototype rich artifact examples', source: 'demo' },
        { id: 'demo-claude-artifacts', cwd: '~/Work/artifacts', updatedAt: '2026-05-21T11:12:00.000Z', kind: 'claude', projectName: 'artifacts', title: 'Review artifact interaction patterns', source: 'demo' },
      ],
    },
    {
      slug: '~-Work-mini-games',
      title: '~/Work/mini-games',
      cwd: '~/Work/mini-games',
      pages: [],
      sessions: [
        { id: 'demo-codex-games', cwd: '~/Work/mini-games', updatedAt: '2026-05-21T11:45:00.000Z', kind: 'codex', projectName: 'mini-games', title: 'Build interactive mini-game artifacts', source: 'demo' },
        { id: 'demo-opencode-games', cwd: '~/Work/mini-games', updatedAt: '2026-05-21T11:35:00.000Z', kind: 'opencode', projectName: 'mini-games', title: 'Tune game controls and collision', source: 'demo' },
      ],
    },
  ],
};
