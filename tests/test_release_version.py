"""Stable application version identity across the npm, Cargo and Tauri packages."""
import importlib.util
import json
import pathlib
import shutil
import tempfile
import unittest

ROOT = pathlib.Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('version', ROOT / 'scripts/verify-release-version.py')
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
FILES = ('package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock')

class ReleaseVersionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        for name in FILES:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        self.current = json.loads((self.root/'package.json').read_text())['version']

    def test_current_metadata_matches(self):
        self.assertEqual(v.verify(self.root), self.current)

    def test_each_identity_mismatch_rejected(self):
        for name in FILES:
            with self.subTest(name=name):
                path = self.root/name; before = path.read_text()
                # Lockfiles only replace application entries, not dependency versions.
                if name.endswith('Cargo.lock'):
                    after = before.replace(f'name = "inkleet"\nversion = "{self.current}"', 'name = "inkleet"\nversion = "99.99.99"')
                else:
                    after = before.replace(f'"{self.current}"', '"99.99.99"', 1)
                path.write_text(after)
                with self.assertRaises(ValueError):v.verify(self.root)
                path.write_text(before)

    def test_prerelease_and_unsafe_version_rejected(self):
        path = self.root/'package.json'; package = json.loads(path.read_text())
        for invalid in ('v0.1.2', '01.1.2', '0.1.2-rc.1', '0.1.2+build', '../0.1.2', '0.1', ''):
            with self.subTest(version=invalid):
                package['version'] = invalid;path.write_text(json.dumps(package))
                with self.assertRaises(ValueError):v.verify(self.root)

if __name__ == '__main__':unittest.main()
