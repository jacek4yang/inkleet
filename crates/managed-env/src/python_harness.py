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

class NestedInteger:
    def __init__(self, value=None):
        self._integer = value
        self._list = []
    def isInteger(self):
        return self._integer is not None
    def add(self, elem):
        if self.isInteger():
            self._integer = None
            self._list = []
        self._list.append(elem)
    def setInteger(self, value):
        self._integer, self._list = value, []
    def getInteger(self):
        return self._integer
    def getList(self):
        return self._list if not self.isInteger() else None

MAX_NODES = 10000

def nested_decode(value, nested_type, budget=None, depth=0):
    if budget is None:
        budget = [MAX_NODES]
    budget[0] -= 1
    if budget[0] < 0 or depth > 64:
        raise ValueError("NestedInteger exceeds node/depth limits")
    result = nested_type()
    if type(value) is int:
        if not -(2**31) <= value < 2**31:
            raise ValueError("NestedInteger integer exceeds i32")
        result.setInteger(value)
    elif isinstance(value, list):
        for item in value:
            result.add(nested_decode(item, nested_type, budget, depth + 1))
    else:
        raise ValueError("NestedInteger requires integers or nested arrays")
    return result

def decode(value, kind, node_types=(ListNode, TreeNode, NestedInteger)):
    list_type, tree_type = node_types[:2]
    nested_type = node_types[2] if len(node_types) > 2 else NestedInteger
    if kind.endswith("[]"):
        if not isinstance(value, list):
            raise ValueError("Array input must be a JSON array")
        return [decode(item, kind[:-2], node_types) for item in value]
    if kind == "NestedInteger":
        return nested_decode(value, nested_type)
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
        head = tail = None
        for item in value:
            node = list_type(decode(item, "integer", node_types))
            if tail is None:
                head = node
            else:
                tail.next = node
            tail = node
        if tail is not None:
            tail.next = None
        return head
    elif kind == "TreeNode":
        if value is None or value == []:
            return None
        if not isinstance(value, list) or len(value) > MAX_NODES:
            raise ValueError("Tree must be a bounded level-order JSON array")
        if value[0] is None:
            if any(item is not None for item in value):
                raise ValueError("Tree has nodes without a root")
            return None
        root = tree_type(decode(value[0], "integer", node_types))
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
                    child = tree_type(decode(item, "integer", node_types))
                    setattr(node, side, child)
                    queue.append(child)
        if any(item is not None for item in value[index:]):
            raise ValueError("Tree has unreachable nodes")
        return root
    else:
        raise ValueError("Unsupported input type")
    return value

def encode(value, active=None, budget=None, node_types=(ListNode, TreeNode, NestedInteger)):
    list_type, tree_type = node_types[:2]
    nested_type = node_types[2] if len(node_types) > 2 else NestedInteger
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
        if isinstance(value, nested_type):
            item = value.getInteger() if value.isInteger() else value.getList()
            if value.isInteger() and (type(item) is not int or not -(2**31) <= item < 2**31):
                raise ValueError("Invalid NestedInteger integer")
            if not value.isInteger() and (not isinstance(item, list) or any(not isinstance(v, nested_type) for v in item)):
                raise ValueError("Invalid NestedInteger list")
            return encode(item, active, budget, node_types)
        if isinstance(value, list_type):
            result, seen = [], set()
            while value is not None:
                if not isinstance(value, list_type) or id(value) in seen:
                    raise ValueError("Linked list contains a cycle or invalid node")
                seen.add(id(value))
                if len(seen) > MAX_NODES:
                    raise ValueError("Linked list exceeds the node limit")
                result.append(encode(value.val, active, budget, node_types))
                value = value.next
            return result
        if isinstance(value, tree_type):
            result, seen, queue = [], set(), collections.deque([value])
            while queue:
                node = queue.popleft()
                if node is None:
                    result.append(None)
                    continue
                if not isinstance(node, tree_type) or id(node) in seen:
                    raise ValueError("Tree contains a cycle or shared node")
                seen.add(id(node))
                if len(seen) > MAX_NODES:
                    raise ValueError("Tree exceeds the node limit")
                result.append(encode(node.val, active, budget, node_types))
                queue.extend((node.left, node.right))
            while result and result[-1] is None:
                result.pop()
            return result
        if isinstance(value, (list, tuple)):
            return [encode(item, active, budget, node_types) for item in value]
        if isinstance(value, dict):
            if not all(isinstance(key, str) for key in value):
                raise ValueError("Object result keys must be strings")
            return {key: encode(item, active, budget, node_types) for key, item in value.items()}
        raise ValueError("Unsupported result value")
    finally:
        active.remove(identity)

def design_call(metadata, raw, loaded, node_types):
    operations, values = raw
    methods = {method["name"]: method for method in metadata["methods"]}
    classname = metadata["classname"]
    if not operations or operations[0] != classname or len(operations) != len(values):
        raise ValueError("Invalid design operation sequence")
    cls = loaded.get(classname)
    if not isinstance(cls, type):
        raise ValueError("Design class is missing from the solution")
    instance, answers = None, []
    for index, (operation, arguments) in enumerate(zip(operations, values)):
        signature = metadata["constructor"] if index == 0 else methods.get(operation)
        if signature is None or len(arguments) != len(signature["params"]):
            raise ValueError("Design operation is not declared in problem metadata")
        decoded = [decode(value, parameter["type"], node_types) for value, parameter in zip(arguments, signature["params"])]
        try:
            if index == 0:
                instance = cls(*decoded)
                answers.append(None)
            else:
                value = getattr(instance, operation)(*decoded)
                # Encode now: later mutations must not rewrite earlier returned values.
                answers.append(None if signature["return"]["type"] == "void" else encode(value, node_types=node_types))
        except Exception as error:
            raise ValueError(f"Operation {index + 1} ({operation}): {type(error).__name__}: {error}") from error
    return answers

def execute(config, solution, results):
    namespace = {"ListNode": ListNode, "TreeNode": TreeNode, "NestedInteger": NestedInteger}
    for module in (typing, collections, heapq, itertools, math, functools, bisect):
        namespace.update({name: getattr(module, name) for name in dir(module) if not name.startswith("_")})
    namespace.update({"collections": collections, "heapq": heapq, "itertools": itertools, "math": math, "functools": functools, "bisect": bisect, "random": random, "statistics": statistics, "operator": operator, "re": re, "string": string})
    metadata = config["metadata"]
    if metadata.get("systemdesign"):
        # A judge class must be explicitly authored/imported, not accidentally
        # satisfied by a convenience-prelude class such as collections.Counter.
        namespace.pop(metadata["classname"], None)
    loaded = runpy.run_path(str(solution), init_globals=namespace)
    signatures = [metadata]
    if metadata.get("systemdesign"):
        signatures = [metadata["constructor"], *metadata["methods"]]
    required_nodes = {entry.get("type", "").replace("[]", "") for signature in signatures
                      for entry in [*signature.get("params", []), signature.get("return") or {}]}
    bindings = (loaded.get("ListNode", ListNode), loaded.get("TreeNode", TreeNode), loaded.get("NestedInteger", NestedInteger))
    node_types = tuple(binding if isinstance(binding, type) else default
                       for binding, default in zip(bindings, (ListNode, TreeNode, NestedInteger)))
    total_bytes = 0
    with results.open("x", encoding="utf-8") as output:
        for index, raw in enumerate(config["cases"]):
            try:
                for name, binding in zip(("ListNode", "TreeNode", "NestedInteger"), bindings):
                    if name in required_nodes and not isinstance(binding, type):
                        raise ValueError(f"{name} must be a class with the official-compatible constructor")
                if metadata.get("systemdesign"):
                    record = {"case": index + 1, "ok": True, "value": design_call(metadata, raw, loaded, node_types)}
                else:
                    arguments = [decode(value, parameter["type"], node_types) for value, parameter in zip(raw, metadata["params"])]
                    if "Solution" in loaded:
                        function = getattr(loaded["Solution"](), metadata["name"])
                    else:
                        function = loaded[metadata["name"]]
                    value = function(*arguments)
                    record = {"case": index + 1, "ok": True, "value": encode(value, node_types=node_types)}
                    if (metadata.get("return") or {}).get("type") == "void":
                        record["argumentsAfterCall"] = encode(arguments, node_types=node_types)
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
