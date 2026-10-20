import { describe, expect, it } from 'vitest';
import { useNotificationsStore } from './notifications';

const READ_KEY = 'pharmacy.notifications.read';

describe('notifications read state', () => {
  it('marks a single notification read exactly once and persists it', () => {
    useNotificationsStore.getState().markRead('low-prod_1');
    useNotificationsStore.getState().markRead('low-prod_1');

    expect(useNotificationsStore.getState().readIds).toEqual(['low-prod_1']);
    expect(JSON.parse(window.localStorage.getItem(READ_KEY) ?? '[]')).toEqual(['low-prod_1']);
  });

  it('marks many as read without duplicating existing ids', () => {
    useNotificationsStore.getState().markRead('a');
    useNotificationsStore.getState().markManyRead(['a', 'b', 'c']);

    expect(new Set(useNotificationsStore.getState().readIds)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('prunes read flags for notifications that no longer exist', () => {
    useNotificationsStore.getState().markManyRead(['a', 'b', 'c']);
    useNotificationsStore.getState().prune(['b', 'c', 'd']);

    expect(useNotificationsStore.getState().readIds).toEqual(['b', 'c']);
    expect(JSON.parse(window.localStorage.getItem(READ_KEY) ?? '[]')).toEqual(['b', 'c']);
  });
});
