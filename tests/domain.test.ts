import { describe, expect, test } from 'bun:test';
import { projectName, toGroupSlug, prettyPath } from '../src/domain/path.ts';
import { matchesSearch } from '../src/features/sidebar/filter.ts';

describe('path domain', () => {
  test('turns cwd into stable group slug', () => {
    expect(toGroupSlug('/home/igorw/Work/agent dashboard', '/home/igorw')).toBe('~-Work-agent-dashboard');
  });
  test('renders slugs as paths', () => {
    expect(prettyPath('~-Work-agent-dashboard')).toBe('~/Work/agent/dashboard');
  });
  test('derives project name', () => {
    expect(projectName('/home/igorw/Work/agent-dashboard')).toBe('agent-dashboard');
  });
});

describe('sidebar search', () => {
  const group = { slug: '~-Work-agent-dashboard', title: 'x', cwd: '/home/igorw/Work/agent-dashboard', pages: [{ file: '~-Work-agent-dashboard__hardening-proposal.tsx', group: '~-Work-agent-dashboard', slug: 'hardening-proposal' }], sessions: [{ id: '1', cwd: '/home/igorw/Work/agent-dashboard', kind: 'pi' as const, projectName: 'agent-dashboard', title: 'Refactor session importer', source: 'x' }] };
  test('matches artifact names and session titles', () => {
    expect(matchesSearch(group, 'hardening')).toBe(true);
    expect(matchesSearch(group, 'importer')).toBe(true);
    expect(matchesSearch(group, 'nope')).toBe(false);
  });
});
