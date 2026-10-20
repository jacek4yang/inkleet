#!/usr/bin/env python3
"""Fail closed when app package versions disagree before release builds."""
import json
import pathlib
import re
import tomllib

def verify(root):
    def js(path):
        return json.loads((root / path).read_text(encoding="utf-8"))
    def toml(path):
        with (root / path).open("rb") as stream:
            return tomllib.load(stream)
    version = js("package.json")["version"]
    if re.fullmatch(r"0\.1\.1", version) is None:
        raise ValueError("The current preview requires application version 0.1.1")
    lock = js("package-lock.json")
    values = {
        "npm lock": lock["version"],
        "npm root package": lock["packages"][""]["version"],
        "Tauri": js("src-tauri/tauri.conf.json")["version"],
        "Cargo package": toml("src-tauri/Cargo.toml")["package"]["version"],
    }
    packages = [p for p in toml("src-tauri/Cargo.lock")["package"] if p["name"] == "inkleet"]
    if len(packages) != 1:
        raise ValueError("Expected one application entry in Cargo.lock")
    values["Cargo lock"] = packages[0]["version"]
    for name, found in values.items():
        if found != version:
            raise ValueError(f"{name} version {found!r} differs from {version!r}")
    return version

if __name__ == "__main__":
    root = pathlib.Path(__file__).resolve().parents[1]
    print(f"Release metadata verified: {verify(root)}")
