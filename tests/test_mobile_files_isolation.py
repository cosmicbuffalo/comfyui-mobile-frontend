"""The file listing and the write paths must answer to ownership.

`/mobile/api/files` walks the tree off disk, so without these checks it hands
every signed-in account the whole thing -- names, sizes and folder structure --
while the endpoints serving the bytes refuse them. And the write paths validated
only path traversal, so one account could delete or move another's outputs.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mobile_auth
import mobile_routes_files as routes


class FakeAuth:
    """Stands in for the auth node: `mine/` is the viewer's, `theirs/` is not."""

    def __init__(self, enabled=True):
        self.enabled = enabled

    def is_enabled(self):
        return self.enabled

    def _owned(self, path):
        return '/theirs' not in path.replace(os.sep, '/')

    def filter_files(self, paths, user=None):
        return [p for p in paths if self._owned(p)]

    def can_modify_file(self, path, user=None):
        return self._owned(path)

    def can_read_file(self, path, user=None):
        return self._owned(path)

    def badge_for_file(self, path, user=None):
        return {'owned': self._owned(path), 'globe': False, 'avatarUserId': None}

    def virtually_deleted_paths(self, paths, user=None):
        return []

    def folder_badges(self, paths, tree='output', user=None):
        return {
            p: {'visible': not p.startswith('theirs'), 'owned': not p.startswith('theirs'),
                'globe': False, 'avatarUserId': None}
            for p in paths
        }

    def current_user(self):
        return {'id': 'viewer', 'roles': ['user']}


@pytest.fixture
def fake_auth(monkeypatch):
    auth = FakeAuth()
    for name in ('is_enabled', 'filter_files', 'can_modify_file', 'can_read_file',
                 'badge_for_file', 'virtually_deleted_paths', 'folder_badges',
                 'current_user'):
        monkeypatch.setattr(mobile_auth, name, getattr(auth, name))
    return auth


def _listing():
    return [
        {'path': 'mine/a.png', 'type': 'file'},
        {'path': 'theirs/b.png', 'type': 'file'},
        {'path': 'mine', 'type': 'dir'},
        {'path': 'theirs', 'type': 'dir'},
    ]


def test_listing_drops_foreign_files_and_folders(fake_auth):
    kept = routes._filter_by_ownership(_listing(), 'output', '/out', None, True)
    assert [r['path'] for r in kept] == ['mine/a.png', 'mine']


def test_listing_untouched_when_auth_is_absent(fake_auth):
    fake_auth.enabled = False
    kept = routes._filter_by_ownership(_listing(), 'output', '/out', None, True)
    assert len(kept) == 4, 'a single-user install must list exactly what it did before'


def test_kept_files_carry_their_badge(fake_auth):
    kept = routes._filter_by_ownership(_listing(), 'output', '/out', None, True)
    mine = next(r for r in kept if r['path'] == 'mine/a.png')
    assert mine['ownership']['owned'] is True


def test_write_check_follows_ownership(fake_auth, tmp_path):
    mine = tmp_path / 'mine.png'
    mine.write_bytes(b'x')
    theirs = tmp_path / 'theirs.png'
    theirs.write_bytes(b'x')
    assert routes._may_modify(str(mine)) is True
    assert routes._may_modify(str(theirs)) is False


def test_a_folder_is_writable_only_if_all_of_it_is(fake_auth, tmp_path):
    folder = tmp_path / 'batch'
    folder.mkdir()
    (folder / 'mine.png').write_bytes(b'x')
    assert routes._may_modify(str(folder)) is True
    # One foreign file is enough to refuse the whole delete rather than
    # half-apply it.
    (folder / 'theirs.png').write_bytes(b'x')
    assert routes._may_modify(str(folder)) is False


def test_write_check_is_a_no_op_without_the_auth_node(fake_auth, tmp_path):
    fake_auth.enabled = False
    theirs = tmp_path / 'theirs.png'
    theirs.write_bytes(b'x')
    assert routes._may_modify(str(theirs)) is True


def test_unassigned_folders_pass_through_for_an_ordinary_account(fake_auth, tmp_path):
    theirs = tmp_path / 'ad-hoc'
    theirs.mkdir()
    (theirs / 'theirs.png').write_bytes(b'x')
    fake_auth.folder_badges = lambda paths, tree='output', user=None: {}
    listing = [{'path': 'ad-hoc', 'type': 'dir'}]
    kept = routes._filter_by_ownership(listing, 'output', str(tmp_path),
                                       {'id': 'v', 'roles': ['user']}, True)
    assert [r['path'] for r in kept] == ['ad-hoc'], (
        'an ordinary account keeps ad-hoc folders navigable')


def test_an_isolated_account_loses_folders_holding_nothing_it_may_see(fake_auth, tmp_path):
    theirs = tmp_path / 'theirs-folder'
    theirs.mkdir()
    (theirs / 'theirs.png').write_bytes(b'x')
    mine = tmp_path / 'mine-folder'
    mine.mkdir()
    (mine / 'mine.png').write_bytes(b'x')
    fake_auth.folder_badges = lambda paths, tree='output', user=None: {}
    listing = [{'path': 'theirs-folder', 'type': 'dir'}, {'path': 'mine-folder', 'type': 'dir'}]
    kept = routes._filter_by_ownership(listing, 'output', str(tmp_path),
                                       {'id': 'v', 'roles': ['isolated']}, True)
    assert [r['path'] for r in kept] == ['mine-folder'], (
        'isolated means the name of a folder it can see nothing in stays hidden')


def test_an_isolated_account_sees_only_its_own_inputs(fake_auth):
    listing = [{'path': 'mine.png', 'type': 'file'}, {'path': 'theirs.png', 'type': 'file'}]
    ordinary = routes._filter_by_ownership(list(listing), 'input', '/in',
                                           {'id': 'v', 'roles': ['user']}, True)
    assert len(ordinary) == 2, 'the shared input pool stays visible to ordinary accounts'
    isolated = routes._filter_by_ownership(list(listing), 'input', '/in',
                                           {'id': 'v', 'roles': ['isolated']}, True)
    assert [r['path'] for r in isolated] == ['mine.png']


def test_a_newly_made_empty_folder_does_not_vanish_from_its_creator(fake_auth, tmp_path):
    # An isolated account creating a folder gets an empty one; if "holds nothing
    # I can see" hid it, it would disappear the instant it was made.
    fresh = tmp_path / 'Picks'
    fresh.mkdir()
    fake_auth.folder_badges = lambda paths, tree='output', user=None: {}
    kept = routes._filter_by_ownership([{'path': 'Picks', 'type': 'dir'}], 'output',
                                       str(tmp_path), {'id': 'v', 'roles': ['isolated']}, True)
    assert [r['path'] for r in kept] == ['Picks']
