"""Built-in nodes. To add a node: create a module exposing DEFINITION and add it here."""
from ..registry import Registry
from . import condition, filter_files, finish, list_files, move_file, start

BUILTIN_MODULES = (start, list_files, filter_files, condition, move_file, finish)


def build_registry() -> Registry:
    reg = Registry()
    for m in BUILTIN_MODULES:
        reg.register(m.DEFINITION)
    return reg
