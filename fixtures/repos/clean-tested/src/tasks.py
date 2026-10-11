"""Task model and in-memory store with JSON persistence."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class Task:
    id: int
    title: str
    done: bool = False


@dataclass
class TaskStore:
    tasks: list[Task] = field(default_factory=list)

    def add(self, title: str) -> Task:
        if not title.strip():
            raise ValueError("title must not be empty")
        task = Task(id=self._next_id(), title=title.strip())
        self.tasks.append(task)
        return task

    def complete(self, task_id: int) -> Task:
        task = self._get(task_id)
        task.done = True
        return task

    def remove(self, task_id: int) -> None:
        self.tasks.remove(self._get(task_id))

    def filter(self, status: str) -> list[Task]:
        if status == "open":
            return [t for t in self.tasks if not t.done]
        if status == "done":
            return [t for t in self.tasks if t.done]
        return list(self.tasks)

    def save(self, path: Path) -> None:
        path.write_text(json.dumps([asdict(t) for t in self.tasks], indent=2))

    @classmethod
    def load(cls, path: Path) -> "TaskStore":
        if not path.exists():
            return cls()
        return cls([Task(**raw) for raw in json.loads(path.read_text())])

    def _get(self, task_id: int) -> Task:
        for task in self.tasks:
            if task.id == task_id:
                return task
        raise KeyError(f"no task with id {task_id}")

    def _next_id(self) -> int:
        return max((t.id for t in self.tasks), default=0) + 1
