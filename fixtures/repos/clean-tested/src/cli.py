"""Command-line interface for the task store."""
import argparse
from pathlib import Path

from tasks import TaskStore

DB = Path("tasks.json")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tasklist")
    sub = parser.add_subparsers(dest="cmd", required=True)
    add = sub.add_parser("add")
    add.add_argument("title")
    done = sub.add_parser("done")
    done.add_argument("id", type=int)
    lst = sub.add_parser("list")
    lst.add_argument("--status", choices=["open", "done", "all"], default="all")
    args = parser.parse_args(argv)

    store = TaskStore.load(DB)
    if args.cmd == "add":
        print(store.add(args.title))
    elif args.cmd == "done":
        print(store.complete(args.id))
    else:
        for task in store.filter(args.status):
            print(f"[{'x' if task.done else ' '}] {task.id}: {task.title}")
    store.save(DB)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
