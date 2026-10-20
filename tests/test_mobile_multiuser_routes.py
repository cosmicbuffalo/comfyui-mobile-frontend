"""Routes that act on files or shared records must answer to the signed-in account.

Each of these used to act for whoever called it: workflow folders resolved to
the admin's `default` tree, copy-to-input read and overwrote any file, and file
marks and queue metadata were one store shared by every account.
"""
import asyncio
import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mobile_auth
import mobile_queue_metadata
import mobile_routes_aliases
import mobile_routes_files
import mobile_routes_media


class FakeWeb:
    @staticmethod
    def json_response(data, status=200):
        return SimpleNamespace(status=status, data=data)


class FakeRequest:
    def __init__(self, body=None, query=None):
        self._body = body or {}
        self.query = query or {}
        self.rel_url = SimpleNamespace(query=self.query)

    async def json(self):
        return self._body


def call(handler, **kwargs):
    return asyncio.run(handler(FakeRequest(**kwargs)))


@pytest.fixture
def signed_in(monkeypatch):
    """Multiuser on; anything under a `theirs` folder belongs to someone else."""
    def readable(path, user=None):
        return '/theirs/' not in path.replace(os.sep, '/')
    monkeypatch.setattr(mobile_auth, 'is_enabled', lambda: True)
    monkeypatch.setattr(mobile_auth, 'current_user', lambda: {'id': 'demo', 'roles': ['user']})
    monkeypatch.setattr(mobile_auth, 'can_read_file', readable)
    monkeypatch.setattr(mobile_auth, 'can_modify_file', readable)
    for module in (mobile_routes_files, mobile_routes_aliases, mobile_routes_media):
        monkeypatch.setattr(module, 'web', FakeWeb)


def test_workflow_folders_are_the_callers_own(signed_in, monkeypatch, tmp_path):
    admin = tmp_path / 'default' / 'workflows' / 'Showcase'
    mine = tmp_path / 'u_demo' / 'workflows' / 'Showcase'
    admin.mkdir(parents=True)
    mine.mkdir(parents=True)
    manager = SimpleNamespace(get_request_user_filepath=lambda request, file, create_dir=True:
                              str(tmp_path / 'u_demo' / file))
    monkeypatch.setattr(mobile_routes_files.server, 'PromptServer',
                        SimpleNamespace(instance=SimpleNamespace(user_manager=manager)))

    assert call(mobile_routes_files.api_delete_workflow_folder, query={'path': 'Showcase'}).status == 200
    assert not mine.exists()
    assert admin.exists()
    assert call(mobile_routes_files.api_create_workflow_folder, body={'path': 'New'}).status == 200
    assert (tmp_path / 'u_demo' / 'workflows' / 'New').is_dir()
    assert not (tmp_path / 'default' / 'workflows' / 'New').exists()
    assert call(mobile_routes_files.api_delete_workflow_folder, query={'path': '../../default/workflows/Showcase'}).status == 403


@pytest.fixture
def trees(monkeypatch, tmp_path):
    output, inputs = tmp_path / 'output', tmp_path / 'input'
    (output / 'theirs').mkdir(parents=True)
    (output / 'mine').mkdir()
    (inputs / 'theirs').mkdir(parents=True)
    monkeypatch.setattr(mobile_routes_aliases.folder_paths, 'get_output_directory', lambda: str(output))
    monkeypatch.setattr(mobile_routes_aliases.folder_paths, 'get_input_directory', lambda: str(inputs))
    return output, inputs


def test_copy_to_input_refuses_a_file_the_caller_may_not_read(signed_in, trees):
    output, inputs = trees
    (output / 'theirs' / 'secret.png').write_bytes(b'not yours')
    response = call(mobile_routes_aliases.api_copy_file_to_input, body={'path': 'theirs/secret.png'})
    assert response.status == 403
    assert not (inputs / 'secret.png').exists()


def test_copy_to_input_never_overwrites_someone_elses_input(signed_in, trees, monkeypatch):
    output, inputs = trees
    (output / 'mine' / 'ref.png').write_bytes(b'my image')
    (inputs / 'ref.png').write_bytes(b'their upload')
    monkeypatch.setattr(mobile_auth, 'can_modify_file', lambda path, user=None: False)
    response = call(mobile_routes_aliases.api_copy_file_to_input, body={'path': 'mine/ref.png'})
    assert response.status == 200
    assert response.data['name'] == 'ref_1.png'
    assert (inputs / 'ref.png').read_bytes() == b'their upload'
    assert (inputs / 'ref_1.png').read_bytes() == b'my image'


def test_file_marks_are_each_accounts_own(signed_in, monkeypatch, tmp_path):
    output = tmp_path / 'output'
    (output / 'theirs').mkdir(parents=True)
    (output / 'mine').mkdir()
    (output / 'theirs' / 'b.png').write_bytes(b'theirs')
    (output / 'mine' / 'a.png').write_bytes(b'mine')
    (output / 'mine' / 'shared.png').write_bytes(b'both may see this')
    viewer = {'id': 'demo'}

    def user_file(request, file, create_dir=True):
        path = tmp_path / 'user' / viewer['id'] / file
        path.parent.mkdir(parents=True, exist_ok=True)
        return str(path)
    monkeypatch.setattr(mobile_routes_files.server, 'PromptServer', SimpleNamespace(
        instance=SimpleNamespace(user_manager=SimpleNamespace(get_request_user_filepath=user_file))))
    monkeypatch.setattr(mobile_routes_files, '_source_base_dir', lambda source: str(output))

    def mark(path, state, value=True):
        return call(mobile_routes_files.api_set_file_state, body={'path': path, 'state': state, 'value': value}).status

    def marks():
        return call(mobile_routes_files.api_get_file_state, query={'source': 'output'}).data

    viewer['id'] = 'nick'
    assert mark('mine/shared.png', 'hidden') == 200
    assert mark('mine/shared.png', 'favorite') == 200
    viewer['id'] = 'demo'
    # Nick's marks are his: demo still sees the file, unmarked.
    assert marks()['hidden'] == [] and marks()['favorite'] == []
    assert mark('mine/a.png', 'favorite') == 200
    assert marks()['favorite'] == ['mine/a.png']
    assert call(mobile_routes_files.api_get_file_favorites, query={'source': 'output'}).data == {'favorites': ['mine/a.png']}
    viewer['id'] = 'nick'
    assert marks()['favorite'] == ['mine/shared.png']
    assert marks()['hidden'] == ['mine/shared.png']

    # And nobody marks a file they may not read.
    viewer['id'] = 'demo'
    for state in ('favorite', 'reject', 'hidden'):
        assert mark('theirs/b.png', state) == 403, state
    assert call(mobile_routes_files.api_set_file_favorite, body={'path': 'theirs/b.png', 'favorite': True}).status == 403


def test_a_new_folder_goes_where_its_creator_may_write_and_is_theirs(signed_in, monkeypatch, tmp_path):
    output = tmp_path / 'output'
    (output / 'mine').mkdir(parents=True)
    (output / 'theirs').mkdir()
    (output / 'shared').mkdir()
    monkeypatch.setattr(mobile_routes_files, '_source_base_dir', lambda source: str(output))
    assigned = []
    monkeypatch.setattr(mobile_auth, 'can_create_folder',
                        lambda path, tree='output', user=None: not path.startswith('theirs/'))
    monkeypatch.setattr(mobile_auth, 'assign_new_folder',
                        lambda path, tree='output', user=None: assigned.append((tree, path)) or True)

    def mkdir(path, source='output'):
        return call(mobile_routes_files.api_mkdir, body={'path': path, 'source': source}).status

    assert mkdir('theirs/new') == 403
    assert not (output / 'theirs' / 'new').exists()
    # Nested: the first missing level is the new folder, and the one assigned.
    assert mkdir('mine/new/deeper') == 200
    assert (output / 'mine' / 'new' / 'deeper').is_dir()
    assert assigned == [('output', 'mine/new')]
    # An existing folder is never claimed.
    assert mkdir('shared') == 200
    assert assigned == [('output', 'mine/new')]
    # If the owner cannot be recorded, the folder does not stay behind shared.
    monkeypatch.setattr(mobile_auth, 'assign_new_folder', lambda path, tree='output', user=None: False)
    assert mkdir('orphan/inner') == 500
    assert not (output / 'orphan').exists()


def test_folder_ownership_follows_deletes_moves_and_renames(signed_in, monkeypatch, tmp_path):
    output = tmp_path / 'output'
    for name in ('mine/inner', 'theirs', 'holds-theirs/theirs', 'target', 'gone/deep'):
        (output / name).mkdir(parents=True)
    monkeypatch.setattr(mobile_routes_files, '_source_base_dir', lambda source: str(output))
    monkeypatch.setattr(mobile_routes_files, '_file_state_path', lambda request: str(tmp_path / 'state.json'))
    # Someone else owns every folder called `theirs`, and what is inside it.
    monkeypatch.setattr(mobile_auth, 'can_modify_file', lambda path, user=None:
                        'theirs' not in path.replace(os.sep, '/').split('/'))
    events = []
    monkeypatch.setattr(mobile_auth, 'folder_moved', lambda old, new, tree='output': events.append(('moved', tree, old, new)))
    monkeypatch.setattr(mobile_auth, 'folder_deleted', lambda path, tree='output': events.append(('deleted', tree, path)))

    def post(handler, **body):
        return call(handler, body=body).status

    # Not their folder, nor one of yours that holds theirs.
    assert post(mobile_routes_files.api_delete_file, path='theirs') == 403
    assert post(mobile_routes_files.api_delete_file, path='holds-theirs') == 403
    assert post(mobile_routes_files.api_move_files, sources=['mine'], destination='theirs') == 403
    assert (output / 'theirs').is_dir() and (output / 'holds-theirs').is_dir() and (output / 'mine').is_dir()
    assert events == []

    assert post(mobile_routes_files.api_delete_file, path='gone') == 200
    assert post(mobile_routes_files.api_move_files, sources=['mine'], destination='target') == 200
    assert post(mobile_routes_files.api_rename_file, path='target/mine', newName='renamed') == 200
    assert events == [
        ('deleted', 'output', 'gone'),
        ('moved', 'output', 'mine', 'target/mine'),
        ('moved', 'output', 'target/mine', 'target/renamed'),
    ]
    assert (output / 'target' / 'renamed' / 'inner').is_dir()


def test_batch_metadata_answers_only_for_readable_files(signed_in, tmp_path):
    paths = ['mine/a.png', 'theirs/b.png', '../escape.png', 7]
    assert asyncio.run(mobile_routes_media._batch_paths(str(tmp_path), paths)) == ['mine/a.png']


def test_queue_metadata_belongs_to_whoever_queued_it(tmp_path):
    cache = str(tmp_path / 'queue_metadata.json')
    mobile_queue_metadata.upsert_prompt_metadata(cache, 'p-nick', {'workflowLabel': 'Private'}, 'nick')
    assert mobile_queue_metadata.get_prompt_metadata(cache, None, 'demo') == {}
    assert mobile_queue_metadata.get_prompt_metadata(cache, ['p-nick'], 'demo') == {}
    assert mobile_queue_metadata.upsert_prompt_metadata(cache, 'p-nick', {'workflowLabel': 'Mine now'}, 'demo') is None
    assert mobile_queue_metadata.remap_prompt_metadata(cache, 'p-nick', 'p-demo', 'demo') is None
    # The owner keeps it through a remap, and an admin (unrestricted) sees it.
    assert mobile_queue_metadata.remap_prompt_metadata(cache, 'p-nick', 'p-nick-2', 'nick')['ownerId'] == 'nick'
    assert mobile_queue_metadata.get_prompt_metadata(cache, None)['p-nick-2']['workflowLabel'] == 'Private'
    # A client cannot claim an entry by sending an owner.
    entry = mobile_queue_metadata.upsert_prompt_metadata(cache, 'p-demo', {'ownerId': 'nick'}, 'demo')
    assert entry['ownerId'] == 'demo'
