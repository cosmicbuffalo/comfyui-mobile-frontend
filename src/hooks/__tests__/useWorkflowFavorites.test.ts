import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowFavoritesStore } from '@/hooks/useWorkflowFavorites';

beforeEach(() => {
  useWorkflowFavoritesStore.setState({ favorites: [] });
});

describe('useWorkflowFavorites', () => {
  it('toggles a favorite on and off', () => {
    const { toggleFavorite } = useWorkflowFavoritesStore.getState();
    toggleFavorite('sub/foo.json');
    expect(useWorkflowFavoritesStore.getState().favorites).toEqual(['sub/foo.json']);
    toggleFavorite('sub/foo.json');
    expect(useWorkflowFavoritesStore.getState().favorites).toEqual([]);
  });

  it('remaps a renamed file', () => {
    useWorkflowFavoritesStore.setState({ favorites: ['a.json', 'b.json'] });
    useWorkflowFavoritesStore.getState().renameFavorite('a.json', 'renamed.json');
    expect(useWorkflowFavoritesStore.getState().favorites).toEqual(['renamed.json', 'b.json']);
  });

  it('remaps a renamed folder and all its favorited descendants', () => {
    useWorkflowFavoritesStore.setState({
      favorites: ['sub', 'sub/foo.json', 'sub/deep/bar.json', 'other.json'],
    });
    useWorkflowFavoritesStore.getState().renameFavorite('sub', 'renamed');
    expect(useWorkflowFavoritesStore.getState().favorites).toEqual([
      'renamed',
      'renamed/foo.json',
      'renamed/deep/bar.json',
      'other.json',
    ]);
  });

  it('removes a path and all descendants on delete', () => {
    useWorkflowFavoritesStore.setState({
      favorites: ['sub', 'sub/foo.json', 'subway.json', 'other.json'],
    });
    useWorkflowFavoritesStore.getState().removeFavoritesUnder('sub');
    // "subway.json" must survive — it is not under "sub/".
    expect(useWorkflowFavoritesStore.getState().favorites).toEqual(['subway.json', 'other.json']);
  });
});
