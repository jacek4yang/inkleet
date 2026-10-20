#!/usr/bin/env python3
"""Inspect a CI-built Intel DMG; do not launch, sign, or publish the app."""

import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile


def run(*args, check=True):
    return subprocess.run(args, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, check=check)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    evidence = Path("evidence/macos-intel")
    delivery = Path("delivery/macos-intel")
    evidence.mkdir(parents=True, exist_ok=True)
    commit = run("git", "rev-parse", "HEAD").stdout.strip()
    require(commit == os.environ["GITHUB_SHA"], "Checkout does not match workflow commit")
    require(run("uname", "-m").stdout.strip() == "x86_64", "Intel runner required")
    target = "x86_64-apple-darwin"
    bundle = Path(os.environ["CARGO_TARGET_DIR"]) / target / "release/bundle"
    dmgs = list((bundle / "dmg").glob("*.dmg"))
    require(len(dmgs) == 1, f"Expected exactly one DMG, found {len(dmgs)}")
    dmg = dmgs[0].resolve()
    checked = run("hdiutil", "verify", str(dmg), check=False)
    (evidence / "DMG_VERIFY.txt").write_text(checked.stdout, encoding="utf-8")
    require(checked.returncode == 0, "DMG integrity validation failed")
    config = json.loads(Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    architectures = []
    with tempfile.TemporaryDirectory(prefix="inkleet-dmg-", dir=os.environ["RUNNER_TEMP"]) as mount:
        attached = False
        try:
            run("hdiutil", "attach", str(dmg), "-readonly", "-nobrowse", "-mountpoint", mount)
            attached = True
            apps = [p for p in Path(mount).glob("*.app") if p.is_dir() and not p.is_symlink()]
            require(len(apps) == 1, f"Expected one packaged app, found {len(apps)}")
            app = apps[0]
            info_path = app / "Contents/Info.plist"
            info = plistlib.loads(info_path.read_bytes())
            require(info.get("CFBundleIdentifier") == config["identifier"], "Wrong bundle identifier")
            require(info.get("CFBundleShortVersionString") == config["version"], "Wrong app version")
            executable = info.get("CFBundleExecutable", "")
            require(executable and Path(executable).name == executable, "Invalid main executable")
            main_binary = app / "Contents/MacOS" / executable
            require(main_binary.is_file() and os.access(main_binary, os.X_OK), "Missing executable")
            require("Mach-O" in run("file", "-b", str(main_binary)).stdout,
                    "Main executable is not Mach-O")
            for path in sorted(app.rglob("*")):
                if not path.is_file() or path.is_symlink():
                    continue
                description = run("file", "-b", str(path)).stdout.strip()
                if "Mach-O" not in description:
                    continue
                relative = str(path.relative_to(app))
                archs = run("lipo", "-archs", str(path)).stdout.strip().split()
                require(archs == ["x86_64"], f"Wrong architecture in {relative}: {archs}")
                load_commands = run("otool", "-l", str(path)).stdout
                minimum_versions = re.findall(r"\bminos\s+([0-9.]+)", load_commands)
                minimum_versions += re.findall(
                    r"cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([0-9.]+)", load_commands
                )
                require(minimum_versions, f"No macOS deployment target found in {relative}")
                architectures.append({"path": relative, "file": description, "architectures": archs,
                                      "mach_o_minimum_macos_versions": minimum_versions})
                with (evidence / "MACH_O_LOAD_COMMANDS.txt").open("a", encoding="utf-8") as output:
                    output.write(f"\n=== {relative} ===\n{load_commands}\n")
            require(architectures, "No packaged Mach-O files were verified")
            main_relative = str(main_binary.relative_to(app))
            require(any(item["path"] == main_relative for item in architectures),
                    "Main executable was not included in architecture verification")
            shutil.copy2(info_path, evidence / "Info.plist")
            signature = run("codesign", "--display", "--verbose=4", str(app), check=False)
            (evidence / "CODE_SIGNING.txt").write_text(signature.stdout, encoding="utf-8")
            require("Authority=Developer ID" not in signature.stdout,
                    "Unexpected Developer ID signature in unsigned test workflow")
        finally:
            if attached:
                run("hdiutil", "detach", mount)
    (evidence / "ARCHITECTURES.json").write_text(
        json.dumps(architectures, indent=2) + "\n", encoding="utf-8"
    )
    delivery.mkdir(parents=True, exist_ok=True)
    filename = f"InkLeet_{config['version']}_macos-x86_64_{commit[:12]}_unsigned.dmg"
    shipped = delivery / filename
    shutil.copy2(dmg, shipped)
    checksum = sha256(shipped)
    require(checksum == sha256(dmg), "Delivered DMG differs from inspected DMG")
    (delivery / "SHA256SUMS").write_text(f"{checksum}  {filename}\n", encoding="utf-8")
    repository = os.environ["GITHUB_REPOSITORY"]
    run_url = f"{os.environ['GITHUB_SERVER_URL']}/{repository}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    metadata = {
        "repository": repository,
        "commit": commit,
        "workflow_ref": os.environ.get("GITHUB_WORKFLOW_REF"),
        "workflow_run": run_url,
        "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
        "target": target,
        "runner_label": "macos-15-intel",
        "runner_macos": run("sw_vers", "-productVersion").stdout.strip(),
        "version": config["version"],
        "bundle_identifier": info["CFBundleIdentifier"],
        "declared_minimum_macos": info.get("LSMinimumSystemVersion"),
        "minimum_macos_runtime_compatibility": "not validated; bundle metadata is not a support guarantee",
        "developer_id_signed": False,
        "notarized": False,
        "gui_smoke_test": "not performed by this packaging job",
        "file": filename,
        "sha256": checksum,
        "bytes": shipped.stat().st_size,
        "mach_o_files": architectures,
    }
    (delivery / "BUILD_INFO.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    (delivery / "README.txt").write_text(
        "InkLeet macOS Intel x86_64 development test artifact\n"
        f"Commit: {commit}\nWorkflow: {run_url}\n"
        "This DMG has no Developer ID signing or Apple notarization. macOS may block it.\n"
        "Do not disable system security protections to install it.\n"
        "DMG integrity and the packaged Mach-O architectures were checked in CI.\n"
        "A successful build is not macOS GUI, account login, or end-to-end acceptance.\n"
        "The declared minimum macOS version is metadata, not a tested compatibility guarantee.\n"
        "This app uses the system WebKit; old macOS versions and downloaded language tools need separate testing.\n"
        "Before an upgrade, back up your notes and avoid running two versions against the same data.\n"
        "The application identifier and data location are unchanged from earlier previews.\n"
        "Verify in this extracted directory with: shasum -a 256 -c SHA256SUMS\n",
        encoding="utf-8",
    )
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write(f"### macOS Intel test DMG verified\n\nCommit: `{commit}`\n\n"
                      f"File: `{filename}`\n\nSHA-256: `{checksum}`\n\n"
                      "No Developer ID signing or notarization. GUI and older macOS compatibility are unverified.\n")


if __name__ == "__main__":
    main()
