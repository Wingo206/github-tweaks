import { describe, expect, it } from 'vitest';
import type { PullRequestFile } from '../../shared/types';
import { AutoCollapseState, folderCompletion } from './model';

function file(path: string, viewed: boolean): PullRequestFile {
  return {
    path,
    additions: 1,
    deletions: 0,
    viewedState: viewed ? 'VIEWED' : 'UNVIEWED',
  };
}

describe('folderCompletion', () => {
  it('marks a folder complete only when every file under it is viewed', () => {
    expect(
      folderCompletion([
        file('src/a/one.ts', true),
        file('src/a/two.ts', true),
        file('src/b/three.ts', false),
        file('README.md', false),
      ]),
    ).toEqual(
      new Map([
        ['src', false],
        ['src/a', true],
        ['src/b', false],
      ]),
    );
  });
});

describe('AutoCollapseState', () => {
  it('closes open complete folders and leaves the rest alone', () => {
    const state = new AutoCollapseState();
    state.setFiles([file('src/a/one.ts', true), file('src/b/two.ts', false)]);

    expect(
      state.changes([
        { path: 'src', expanded: true },
        { path: 'src/a', expanded: true },
        { path: 'src/b', expanded: true },
        { path: 'docs', expanded: true },
      ]),
    ).toEqual([{ path: 'src/a', expanded: false }]);
  });

  it('closes every complete folder, nested ones included', () => {
    const state = new AutoCollapseState();
    state.setFiles([file('src/a/one.ts', true)]);

    expect(
      state.changes([
        { path: 'src', expanded: true },
        { path: 'src/a', expanded: true },
      ]),
    ).toEqual([
      { path: 'src', expanded: false },
      { path: 'src/a', expanded: false },
    ]);
  });

  it('leaves a complete folder open after it is reopened', () => {
    const state = new AutoCollapseState();
    state.setFiles([file('src/one.ts', true)]);
    state.noteOpened('src');

    expect(state.changes([{ path: 'src', expanded: true }])).toEqual([]);
  });

  it('closes a reopened folder again after it changes and completes again', () => {
    const state = new AutoCollapseState();
    state.setFiles([file('src/one.ts', true)]);
    state.noteOpened('src');
    state.setFiles([file('src/one.ts', false)]);
    state.setFiles([file('src/one.ts', true)]);

    expect(state.changes([{ path: 'src', expanded: true }])).toEqual([
      { path: 'src', expanded: false },
    ]);
  });

  it('ignores opening a folder that is not complete', () => {
    const state = new AutoCollapseState();
    state.setFiles([file('src/one.ts', false)]);
    state.noteOpened('src');
    state.setFiles([file('src/one.ts', true)]);

    expect(state.changes([{ path: 'src', expanded: true }])).toEqual([
      { path: 'src', expanded: false },
    ]);
  });

  it('reopens a closed folder once, when it stops being complete', () => {
    const state = new AutoCollapseState();
    state.setFiles([file('src/a/one.ts', true)]);
    state.setFiles([file('src/a/one.ts', false)]);

    expect(state.changes([{ path: 'src', expanded: false }])).toEqual([
      { path: 'src', expanded: true },
    ]);
    expect(state.changes([{ path: 'src', expanded: false }])).toEqual([]);
  });

  it('waits to reopen a nested folder until its row is shown', () => {
    const state = new AutoCollapseState();
    state.setFiles([file('src/a/one.ts', true)]);
    state.setFiles([file('src/a/one.ts', false)]);

    expect(state.changes([{ path: 'src', expanded: false }])).toEqual([
      { path: 'src', expanded: true },
    ]);
    expect(
      state.changes([
        { path: 'src', expanded: true },
        { path: 'src/a', expanded: false },
      ]),
    ).toEqual([{ path: 'src/a', expanded: true }]);
  });

  it('does not open folders that were never complete', () => {
    const state = new AutoCollapseState();
    state.setFiles([file('src/one.ts', false)]);

    expect(state.changes([{ path: 'src', expanded: false }])).toEqual([]);
  });

  it('forgets everything on clear', () => {
    const state = new AutoCollapseState();
    state.setFiles([file('src/one.ts', true)]);
    state.clear();

    expect(state.changes([{ path: 'src', expanded: true }])).toEqual([]);
  });
});
