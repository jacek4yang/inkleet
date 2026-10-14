"""InkLeet local fixture harness; never evaluates input strings as Python.
User solution code executes with normal local user privileges. Not a sandbox.
"""
import collections
import contextlib
import dataclasses
import functools
import bisect
import random
import statistics
import operator
import re
import string
import heapq
import itertools
import json
import math
import pathlib
import runpy
import sys
import traceback
import typing

class ListNode:
    def __init__(self, val=0, next=None):
        self.val, self.next = val, next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val, self.left, self.right = val, left, right

MAX_NODES = 10000

def decode(value, kind):
    if kind.endswith("[]"):
        if not isinstance(value, list):
            raise ValueError("Array input must be a JSON array")
        return [decode(item, kind[:-2]) for item in value]
    if kind in ("integer", "long"):
        if type(value) is not int:
            raise ValueError("Integer input expected")
    elif kind == "double":
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError("Finite numeric input expected")
    elif kind == "boolean":
        if type(value) is not bool:
            raise ValueError("Boolean input expected")
    elif kind in ("string", "character"):
        if not isinstance(value, str) or (kind == "character" and len(value) != 1):
            raise ValueError("String or single character input expected")
    elif kind == "ListNode":
        if value is None:
            return None
        if not isinstance(value, list) or len(value) > MAX_NODES:
            raise ValueError("Linked list must be a bounded JSON array")
        dummy = tail = ListNode()
        for item in value:
            tail.next = ListNode(decode(item, "integer"))
            tail = tail.next
        return dummy.next
    elif kind == "TreeNode":
        if value is None or value == []:
            return None
        if not isinstance(value, list) or len(value) > MAX_NODES:
            raise ValueError("Tree must be a bounded level-order JSON array")
        if value[0] is None:
            if any(item is not None for item in value):
                raise ValueError("Tree has nodes without a root")
            return None
        root = TreeNode(decode(value[0], "integer"))
        queue = collections.deque([root])
        index = 1
        while queue and index < len(value):
            node = queue.popleft()
            for side in ("left", "right"):
                if index >= len(value):
                    break
                item = value[index]
                index += 1
                if item is not None:
                    child = TreeNode(decode(item, "integer"))
                    setattr(node, side, child)
                    queue.append(child)
        if any(item is not None for item in value[index:]):
            raise ValueError("Tree has unreachable nodes")
        return root
    else:
        raise ValueError("Unsupported input type")
    return value

def encode(value, active=None, budget=None):
    if active is None:
        active, budget = set(), [MAX_NODES]
    budget[0] -= 1
    if budget[0] < 0:
        raise ValueError("Result exceeds the node limit")
    if value is None or type(value) in (bool, int, str):
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError("Result contains a non-finite number")
        return value
    identity = id(value)
    if identity in active:
        raise ValueError("Result contains a cycle")
    active.add(identity)
    try:
        if isinstance(value, ListNode):
            result, seen = [], set()
            while value is not None:
                if not isinstance(value, ListNode) or id(value) in seen:
                    raise ValueError("Linked list contains a cycle or invalid node")
                seen.add(id(value))
                if len(seen) > MAX_NODES:
                    raise ValueError("Linked list exceeds the node limit")
                result.append(encode(value.val, active, budget))
                value = value.next
            return result
        if isinstance(value, TreeNode):
            result, seen, queue = [], set(), collections.deque([value])
            while queue:
                node = queue.popleft()
                if node is None:
                    result.append(None)
                    continue
                if not isinstance(node, TreeNode) or id(node) in seen:
                    raise ValueError("Tree contains a cycle or shared node")
                seen.add(id(node))
                if len(seen) > MAX_NODES:
                    raise ValueError("Tree exceeds the node limit")
                result.append(encode(node.val, active, budget))
                queue.extend((node.left, node.right))
            while result and result[-1] is None:
                result.pop()
            return result
        if isinstance(value, (list, tuple)):
            return [encode(item, active, budget) for item in value]
        if isinstance(value, dict):
            if not all(isinstance(key, str) for key in value):
                raise ValueError("Object result keys must be strings")
            return {key: encode(item, active, budget) for key, item in value.items()}
        raise ValueError("Unsupported result value")
    finally:
        active.remove(identity)

def execute(config, solution, results):
    namespace = {"ListNode": ListNode, "TreeNode": TreeNode}
    for module in (typing, collections, heapq, itertools, math, functools, bisect):
        namespace.update({name: getattr(module, name) for name in dir(module) if not name.startswith("_")})
    namespace.update({"collections": collections, "heapq": heapq, "itertools": itertools, "math": math, "functools": functools, "bisect": bisect, "random": random, "statistics": statistics, "operator": operator, "re": re, "string": string})
    loaded = runpy.run_path(str(solution), init_globals=namespace)
    metadata = config["metadata"]
    total_bytes = 0
    with results.open("x", encoding="utf-8") as output:
        for index, raw in enumerate(config["cases"]):
            try:
                arguments = [decode(value, parameter["type"]) for value, parameter in zip(raw, metadata["params"])]
                if "Solution" in loaded:
                    function = getattr(loaded["Solution"](), metadata["name"])
                else:
                    function = loaded[metadata["name"]]
                value = function(*arguments)
                record = {"case": index + 1, "ok": True, "value": encode(value)}
                if (metadata.get("return") or {}).get("type") == "void":
                    record["argumentsAfterCall"] = encode(arguments)
                line = json.dumps(record, ensure_ascii=False, allow_nan=False)
            except Exception as error:
                line = json.dumps({"case": index + 1, "ok": False, "error": f"{type(error).__name__}: {error}"[:1000]}, ensure_ascii=False)
                traceback.print_exc(limit=12)
            encoded = (line + "\n").encode("utf-8")
            total_bytes += len(encoded)
            if total_bytes > 1024 * 1024:
                raise ValueError("Local result file exceeds 1 MiB")
            output.write(line + "\n")
            output.flush()

if __name__ == "__main__":
    base = pathlib.Path(__file__).resolve().parent
    config = json.loads((base / "input.json").read_text(encoding="utf-8"))
    execute(config, base / "solution.py", base / "results.jsonl")
