import pytest

from tasks import TaskStore


def test_add_assigns_incrementing_ids():
    store = TaskStore()
    assert store.add("a").id == 1
    assert store.add("b").id == 2


def test_add_rejects_blank_titles():
    with pytest.raises(ValueError):
        TaskStore().add("   ")


def test_complete_and_filter():
    store = TaskStore()
    store.add("a")
    store.add("b")
    store.complete(1)
    assert [t.title for t in store.filter("done")] == ["a"]
    assert [t.title for t in store.filter("open")] == ["b"]


def test_remove_unknown_raises():
    with pytest.raises(KeyError):
        TaskStore().remove(42)


def test_roundtrip(tmp_path):
    store = TaskStore()
    store.add("persist me")
    path = tmp_path / "db.json"
    store.save(path)
    assert TaskStore.load(path).tasks[0].title == "persist me"
