#!/usr/bin/env python3
"""Fail-closed publisher. All inputs are frozen in the reviewed release branch.
No API mutation is retried. On an uncertain failure inspect the draft/tag manually.
"""
import hashlib
import io
import json
import os
import pathlib
import re
import stat
import subprocess
import zipfile

REPO = 'jacek4yang/inkleet'
ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
if not isinstance(VERSION, str) or re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', VERSION) is None:
    raise ValueError('Publisher requires stable numeric application semver')
TAG = 'v' + VERSION
MANIFEST = f'releases/{TAG}.json'
NOTES = f'releases/{TAG}.md'
PROFILE = 'release; default features; diagnostic snippet features disabled'
WINDOWS_STAGES = [
    'current MSI fresh install and real WebView2 save',
    'fresh uninstall preserves saved notebook',
    'public v0.1.1 installed, actual source/notes/named solution saved',
    'upgrade retains v0.1.1 data; real WebView2 reload, archive/restart/restore',
    'upgraded uninstall preserves full synthetic notebook',
]
WINDOWS_UI_ASSERTIONS = {
    'fresh': ['fresh MSI executable starts; settings opens/closes; source and notes saved through real IPC'],
    'legacy': ['public hash-verified v0.1.1 saved source, shared notes and named solution via native UI'],
    'upgraded': ['v0.1.1 source/notes/named ID preserved through MSI upgrade', 'archive cancel and confirm use real storage', 'restart then restore retains unsaved draft without overwriting saved source', 'explicit save persists restored draft'],
}
GUID = r'\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}'
WINDOWS_PAYLOAD_RULE = 'tauri-single-bundle-marker-UNK-to-MSI'
WINDOWS_PAYLOAD_ORIGIN = 'In-memory copy of built_path with the exact single Tauri UNK-to-MSI marker substitution; no files modified'
GATES = {
    'ci': ('.github/workflows/ci.yml', {'CI Frontend Regression'}),
    'editing': ('.github/workflows/editing-lsp.yml', {'Editing LSP (ubuntu-24.04)', 'Editing LSP (windows-2025)', 'Editing LSP (macos-15-intel)'}),
    'harness': ('.github/workflows/local-features.yml', {'Local harness (ubuntu-24.04)', 'Local harness (windows-2025)', 'Local harness (macos-15-intel)'}),
    'native': ('.github/workflows/native.yml', {'Native Linux Full Validation'}),
    'dap': ('.github/workflows/rust-collections.yml', {'Rust collection DAP (linux-x64)', 'Rust collection DAP (windows-x64)', 'Rust collection DAP (macos-x64)'}),
    'package': ('.github/workflows/preview-installers.yml', {'Packaging Frontend Regression', 'Packaging macOS Intel', 'Packaging Windows x64', 'Packaging Linux x86_64', 'Packaging Required'}),
}
PLATFORMS = {
    'windows': ('inkleet-windows-x64-installers-', 'x86_64-pc-windows-msvc', ('.exe', '.msi')),
    'linux': ('inkleet-linux-x86_64-tar-', 'x86_64-unknown-linux-gnu', ('.tar.gz',)),
    'macos': ('inkleet-macos-intel-dmg-', 'x86_64-apple-darwin', ('.dmg',)),
}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hex_value(value, length):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{%d}' % length, value) is not None


def positive(value):
    return type(value) is int and value > 0


def validate_manifest(m):
    require('publisher_recovery' not in m, 'Publisher recovery exceptions are not allowed')
    require(m.get('schema') == 1 and m.get('repository') == REPO, 'Manifest schema/repository mismatch')
    require(m.get('tag') == TAG and m.get('version') == VERSION and m.get('prerelease') is False, 'Unexpected release identity')
    require(hex_value(m.get('source_commit'), 40) and hex_value(m.get('source_tree'), 40), 'Invalid source identity')
    require(hex_value(m.get('notes_sha256'), 64), 'Missing frozen release notes digest')
    require(set(m.get('gates', {})) == set(GATES), 'Missing or unexpected source gates')
    for name, gate in m['gates'].items():
        require(positive(gate.get('run_id')) and positive(gate.get('attempt')), 'Invalid run/attempt')
        require(hex_value(gate.get('qualification_commit'), 40), 'Invalid qualification commit')
        require(gate.get('event') == 'push', 'Only exact main push gates qualify')
        require(gate['qualification_commit'] == m['source_commit'], 'Every gate must qualify exact final main source')
    require(set(m.get('artifacts', {})) == set(PLATFORMS), 'Expected three platform archives')
    filenames = []
    for platform, a in m['artifacts'].items():
        require(positive(a.get('id')) and hex_value(a.get('sha256'), 64), 'Invalid artifact identity/digest')
        prefix, _, extensions = PLATFORMS[platform]
        require(a.get('name') == prefix + m['source_commit'], 'Unexpected artifact platform/name/source')
        require(isinstance(a.get('assets'), list) and len(a['assets']) == len(extensions), 'Wrong asset count')
        found = []
        for asset in a['assets']:
            name = asset.get('name', '')
            require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_.-]+', name), 'Unsafe asset name')
            require(VERSION in name and m['source_commit'][:12] in name, 'Asset version/source not explicit')
            require(('windows-x64' in name if platform == 'windows' else 'linux-x86_64' in name if platform == 'linux' else 'macos-x86_64' in name), 'Asset architecture mismatch')
            ext = next((x for x in extensions if name.endswith(x)), None)
            require(ext is not None and ext not in found, 'Unexpected or duplicate asset format')
            found.append(ext)
            require(positive(asset.get('bytes')) and asset['bytes'] < 200 * 1024 * 1024 and hex_value(asset.get('sha256'), 64), 'Invalid asset size/digest')
            filenames.append(name)
    require(len(filenames) == 4 and len(set(filenames)) == 4, 'Expected four distinct installer assets')


def validate_gate(m, name, run, jobs, qualification_tree):
    frozen = m['gates'][name]
    path, names = GATES[name]
    require(run['id'] == frozen['run_id'] and run['run_attempt'] == frozen['attempt'], 'Run attempt mismatch')
    require(run['repository']['full_name'] == REPO and run['head_repository']['full_name'] == REPO, 'Foreign source run')
    require(run['path'].split('@')[0] == path and run['event'] == frozen['event'], 'Gate workflow/event mismatch')
    require(run['head_sha'] == frozen['qualification_commit'], 'Gate source mismatch')
    require(qualification_tree == m['source_tree'], 'Gate does not qualify the complete source tree')
    require(run['event'] == 'push' and run['head_branch'] == 'main', 'Only main push gates qualify')
    require(run['status'] == 'completed' and run['conclusion'] == 'success', 'Gate not successful')
    for expected in names:
        matches = [j for j in jobs if j['name'] == expected]
        require(len(matches) == 1 and matches[0]['run_id'] == run['id'] and matches[0]['conclusion'] == 'success' and matches[0]['status'] == 'completed', 'Required job missing, skipped or unsuccessful: ' + expected)


def validate_windows_install(m, metadata, report):
    require(isinstance(report, dict) and report.get('result') == 'PASS', 'Windows installed MSI acceptance missing or failed')
    require(report.get('source_commit') == m['source_commit'] and report.get('version') == VERSION and report.get('runner') == 'windows-2025', 'Windows installed source/version/runner mismatch')
    require(report.get('msi_uncertain') is False and report.get('cleanup_errors') == [], 'Windows installer outcome or cleanup uncertain')
    require(report.get('stages') == WINDOWS_STAGES, 'Incomplete Windows install/upgrade/uninstall stages')
    payloads = report.get('payloads', {})
    require(isinstance(payloads, dict) and set(payloads) == {'fresh', 'upgraded'}, 'Missing exact installed MSI payload proofs')
    for value in payloads.values():
        require(isinstance(value, dict) and value.get('result') == 'PASS' and value.get('rule') == WINDOWS_PAYLOAD_RULE, 'Invalid installed MSI payload proof')
        require(all(hex_value(value.get(key), 64) for key in ('built_sha256', 'expected_sha256', 'installed_sha256')), 'Invalid installed payload hashes')
        require(value['expected_sha256'] == value['installed_sha256'] and value['built_sha256'] != value['expected_sha256'], 'Installed executable differs from exact MSI-patched build')
        size = value.get('built_bytes')
        require(positive(size) and 27 <= size < 200 * 1024 * 1024 and size == value.get('expected_bytes') == value.get('installed_bytes') == metadata.get('app_pe', {}).get('bytes'), 'Installed executable byte counts differ')
        offset = value.get('marker_offset')
        require(type(offset) is int and 0 <= offset <= size - 27 and type(value.get('marker_count')) is int and value['marker_count'] == 1 and type(value.get('marker_bytes')) is int and value['marker_bytes'] == 27, 'Invalid or nonunique MSI bundle marker proof')
        require(all(isinstance(value.get(key), str) and value[key] and len(value[key]) <= 4096 for key in ('built_path', 'installed_path')), 'Missing installed payload paths')
        require('expected_path' in value and value['expected_path'] is None and value.get('expected_origin') == WINDOWS_PAYLOAD_ORIGIN, 'Expected payload was not the exact in-memory marker copy')
    for key in ('built_sha256', 'expected_sha256', 'installed_sha256', 'built_bytes', 'marker_offset', 'built_path', 'installed_path'):
        require(payloads['fresh'][key] == payloads['upgraded'][key], 'Fresh and upgraded payload identities differ')
    prior_source = 'fbacb2041b83232a30a791965c58d93a7556a4ff'
    prior = report.get('prior', {})
    require(prior == {'url': f'https://github.com/{REPO}/releases/download/v0.1.1/InkLeet-0.1.1-preview-fbacb2041b83-windows-x64.msi', 'sha256': '1246c47b6a814bb3c3d42ab4972c8ca6a52ecb3fd05d82dfd75000b6921f46e0', 'bytes': 6885376, 'source_commit': prior_source, 'version': '0.1.1'}, 'Wrong public upgrade baseline')
    ui = report.get('ui', {})
    require(isinstance(ui, dict) and set(ui) == {'fresh', 'legacy', 'upgraded'}, 'Windows native phase missing or unexpected')
    for phase, value in ui.items():
        require(isinstance(value, dict), 'Invalid Windows native phase record')
        expected_version = '0.1.1' if phase == 'legacy' else VERSION
        expected_source = prior_source if phase == 'legacy' else m['source_commit']
        require(value.get('result') == 'PASS' and value.get('phase') == phase and value.get('normalClose') is True, 'Windows native phase did not complete normally')
        require(value.get('harnessCommit') == m['source_commit'] and value.get('applicationSourceCommit') == expected_source and value.get('nativeVersion') == expected_version, 'Windows native application/harness identity mismatch')
        require(value.get('assertions') == WINDOWS_UI_ASSERTIONS[phase], 'Missing Windows native assertions')
        launches = value.get('launches', [])
        require(isinstance(launches, list) and len(launches) == (2 if phase == 'upgraded' else 1), 'Missing Windows native restart evidence')
        for launch in launches:
            require(positive(launch.get('pid')) and launch.get('version') == expected_version and re.fullmatch(r'https?://tauri\.localhost(?:/.*)?', launch.get('url', '')) and isinstance(launch.get('webviewVersion'), str) and launch['webviewVersion'], 'Invalid installed WebView2 launch evidence')
    packages = report.get('packages', {})
    require(isinstance(packages, dict), 'Invalid installed MSI package records')
    current, old = packages.get('current', {}), packages.get('legacy', {})
    require(isinstance(current, dict) and isinstance(old, dict), 'Invalid installed MSI identity records')
    require(current.get('productCode') == metadata['msi'].get('product_code') and current.get('version') == VERSION and old.get('version') == '0.1.1' and current.get('name') == old.get('name') == 'InkLeet', 'Installed MSI identity differs from inspected package')
    require(all(isinstance(value, str) and re.fullmatch(GUID, value) for value in [current.get('productCode'), old.get('productCode'), current.get('upgradeCode')]), 'Invalid MSI product/upgrade identifiers')
    require(current.get('productCode') != old.get('productCode') and current.get('upgradeCode') == old.get('upgradeCode') and isinstance(current.get('upgradeCode'), str) and re.fullmatch(GUID, current['upgradeCode']), 'MSI upgrade identity evidence missing')


def inspect_archive(m, platform, info, archive):
    a = m['artifacts'][platform]
    require(info['id'] == a['id'] and info['name'] == a['name'] and info['expired'] is False, 'Wrong/expired artifact')
    require(info['workflow_run']['id'] == m['gates']['package']['run_id'] and info['workflow_run']['head_sha'] == m['source_commit'], 'Artifact not from frozen packaging run')
    require(info['digest'] == 'sha256:' + a['sha256'] and digest(archive) == a['sha256'], 'Artifact archive digest mismatch')
    require(len(archive) < 300 * 1024 * 1024, 'Oversized archive')
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        members = z.infolist()
        names = [i.filename for i in members]
        require(len(names) == len(set(names)) and len(names) <= 100, 'Duplicate/excessive ZIP members')
        require(sum(i.file_size for i in members) < 300 * 1024 * 1024, 'Oversized expanded archive')
        for item in members:
            p = pathlib.PurePosixPath(item.filename)
            require(not p.is_absolute() and '..' not in p.parts and '\\' not in item.filename and ':' not in item.filename and not stat.S_ISLNK(item.external_attr >> 16) and not item.flag_bits & 1, 'Unsafe ZIP entry')
        metadata = json.loads(z.read('BUILD_INFO.json'))
        require(metadata['commit'] == m['source_commit'], 'Embedded source mismatch')
        if platform != 'macos' or 'SOURCE_COMMIT.txt' in names:
            require(z.read('SOURCE_COMMIT.txt').decode('utf-8-sig').strip() == m['source_commit'], 'Embedded source text mismatch')
        require(metadata['target'] == PLATFORMS[platform][1], 'Embedded architecture mismatch')
        require(metadata['workflow_run'] == f"https://github.com/{REPO}/actions/runs/{m['gates']['package']['run_id']}", 'Embedded packaging run mismatch')
        if platform in ('windows', 'macos'):
            require(metadata['version'] == VERSION, 'Embedded version mismatch')
        if platform != 'macos':
            require(metadata['build_profile'] == PROFILE, 'Diagnostic/non-release build cannot ship')
        else:
            # macOS metadata has no profile field; exact reviewed packaging workflow is required.
            require(metadata['developer_id_signed'] is False and metadata['notarized'] is False, 'Unexpected signing claim')
            require(metadata.get('mach_o_files') and all(f['architectures'] == ['x86_64'] for f in metadata['mach_o_files']), 'Missing Intel Mach-O evidence')
            require(metadata.get('file') == a['assets'][0]['name'] and metadata.get('sha256') == a['assets'][0]['sha256'] and metadata.get('bytes') == a['assets'][0]['bytes'], 'DMG metadata differs from frozen asset')
        if platform == 'windows':
            require(metadata['app_pe']['machine'] == 0x8664 and metadata['app_pe']['optional_header_magic'] == 0x20b and metadata['msi']['template'].split(';')[0] == 'x64', 'Missing Windows x64 package evidence')
            report = metadata.get('installed_msi_acceptance')
            validate_windows_install(m, metadata, report)
            require('MSI_INSTALLED_RESULT.json' in names and json.loads(z.read('MSI_INSTALLED_RESULT.json')) == report, 'Windows installed evidence file differs from build metadata')
        result = {}
        for asset in a['assets']:
            data = z.read(asset['name'])
            require(len(data) == asset['bytes'] and digest(data) == asset['sha256'], 'Installer digest/size mismatch')
            result[asset['name']] = data
        return result, metadata


class GitHub:
    """gh handles binary download redirects; never print tokens or retry mutations."""
    def gh(self, *args):
        return subprocess.check_output(['gh', *args])

    def get(self, endpoint):
        return json.loads(self.gh('api', f'repos/{REPO}/{endpoint}'))

    def pages(self, endpoint, key=None):
        output = []
        for page in range(1, 101):
            payload = self.get(endpoint + ('&' if '?' in endpoint else '?') + f'per_page=100&page={page}')
            items = payload[key] if key else payload
            output.extend(items)
            if len(items) < 100:
                return output
        raise ValueError('Pagination exceeded safety bound')

    def binary(self, endpoint):
        # Actions ZIP uses the default API media type and a binary redirect.
        # Release assets instead require octet-stream content negotiation.
        if re.fullmatch(r'actions/artifacts/[1-9][0-9]*/zip', endpoint):
            return self.gh('api', f'repos/{REPO}/{endpoint}')
        require(re.fullmatch(r'releases/assets/[1-9][0-9]*', endpoint), 'Unexpected binary endpoint')
        return self.gh('api', f'repos/{REPO}/{endpoint}', '-H', 'Accept: application/octet-stream')


def require_absent(releases, tags):
    require(not any(r['tag_name'] == TAG for r in releases), 'Existing draft/release: inspect, never overwrite')
    require(not any(t['name'] == TAG for t in tags), 'Existing tag: inspect, never overwrite')


def verify_assets(release, files, github):
    assets = release['assets']
    require(len(assets) == len(files) and {a['name'] for a in assets} == set(files), 'Partial/extra uploaded assets')
    for a in assets:
        expected = files[a['name']]
        require(a['size'] == len(expected), 'Uploaded asset size mismatch')
        require(github.binary(f"releases/assets/{a['id']}") == expected, 'Uploaded bytes mismatch')


def validate_publisher_comparison(comparison, read_bytes):
    expected = {MANIFEST, NOTES}
    files = comparison.get('files', [])
    require(comparison['status'] == 'ahead' and len(files) == len(expected) and {f['filename'] for f in files} == expected, 'Publisher branch must only add frozen manifest/notes to main')
    for f in files:
        require(f['status'] == 'added', 'Frozen release records must be new files')
        data = read_bytes(f['filename'])
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        require(f.get('sha') == blob, 'Remote publisher blob differs from checkout')


def main():
    require(os.environ.get('GITHUB_REPOSITORY') == REPO and os.environ.get('GITHUB_REF') == f'refs/heads/release/{TAG}', 'Only reviewed release branch may publish')
    publisher = os.environ.get('GITHUB_SHA', '')
    require(hex_value(publisher, 40), 'Missing publisher commit')
    root = pathlib.Path(__file__).resolve().parents[1]
    m = json.loads((root / MANIFEST).read_text())
    validate_manifest(m)
    notes = (root / NOTES).read_bytes()
    require(digest(notes) == m['notes_sha256'], 'Release notes changed')
    g = GitHub()
    source = m['source_commit']
    require(g.get('git/ref/heads/main')['object']['sha'] == source, 'Final main source moved; inspect before publication')
    require(g.get(f'git/commits/{source}')['tree']['sha'] == m['source_tree'], 'Source tree mismatch')
    comparison = g.get(f'compare/{source}...{publisher}')
    validate_publisher_comparison(comparison, lambda path: (root / path).read_bytes())
    # Verify app version directly at source, not at an arbitrary publisher checkout.
    package = g.get(f'contents/package.json?ref={source}')
    import base64
    require(json.loads(base64.b64decode(package['content']))['version'] == VERSION, 'Source application version mismatch')
    for name, gate in m['gates'].items():
        run = g.get(f"actions/runs/{gate['run_id']}")
        jobs = g.pages(f"actions/runs/{gate['run_id']}/attempts/{gate['attempt']}/jobs", 'jobs')
        tree = g.get(f"git/commits/{gate['qualification_commit']}")['tree']['sha']
        validate_gate(m, name, run, jobs, tree)
    require_absent(g.pages('releases'), g.pages('tags'))
    files, platforms = {}, {}
    for platform, a in m['artifacts'].items():
        info = g.get(f"actions/artifacts/{a['id']}")
        require(positive(info.get('size_in_bytes')) and info['size_in_bytes'] < 300 * 1024 * 1024, 'Oversized artifact download')
        archive = g.binary(f"actions/artifacts/{a['id']}/zip")
        extracted, metadata = inspect_archive(m, platform, info, archive)
        files.update(extracted); platforms[platform] = metadata
    files['SHA256SUMS'] = ''.join(f'{digest(data)}  {name}\n' for name, data in sorted(files.items())).encode()
    release_manifest = {**m, 'platform_evidence': platforms, 'publisher_commit': publisher}
    files['RELEASE_MANIFEST.json'] = (json.dumps(release_manifest, indent=2, ensure_ascii=False) + '\n').encode()
    out = root / 'verified-release-assets'
    out.mkdir(exist_ok=False)
    for name, data in files.items():
        (out / name).write_bytes(data)
    # Every subsequent mutation is one-shot. Failures leave a draft for inspection.
    require(g.get('git/ref/heads/main')['object']['sha'] == source, 'Main changed during verification')
    g.gh('release', 'create', TAG, '--repo', REPO, '--target', source, '--draft', '--title', f'InkLeet {TAG}', '--notes-file', str(root / NOTES))
    g.gh('release', 'upload', TAG, '--repo', REPO, *[str(out / name) for name in sorted(files)])
    releases = [r for r in g.pages('releases') if r['tag_name'] == TAG]
    require(len(releases) == 1, 'Expected one draft')
    release = g.get(f"releases/{releases[0]['id']}")
    require(release['draft'] is True and release['prerelease'] is False and release['target_commitish'] == source, 'Draft identity mismatch')
    verify_assets(release, files, g)
    require(g.get('git/ref/heads/main')['object']['sha'] == source, 'Main changed before publish')
    # Draft creation may leave the tag absent. If a tag exists it must be exact.
    matching = [t for t in g.pages('tags') if t['name'] == TAG]
    require(not matching or len(matching) == 1 and matching[0]['commit']['sha'] == source, 'Tag source mismatch')
    g.gh('release', 'edit', TAG, '--repo', REPO, '--draft=false', '--prerelease=false')
    public = g.get(f'releases/tags/{TAG}')
    require(not public['draft'] and not public['prerelease'] and public['published_at'], 'Publication not confirmed')
    require(public['id'] == release['id'], 'Published release identity changed')
    tag = g.get(f'git/ref/tags/{TAG}')['object']
    require(tag['type'] == 'commit' and tag['sha'] == source, 'Published tag not frozen source')
    verify_assets(public, files, g)
    print(public['html_url'])


if __name__ == '__main__':
    main()
