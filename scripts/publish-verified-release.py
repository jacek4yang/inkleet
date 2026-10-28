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
TAG = 'v0.1.1'
VERSION = '0.1.1'
MANIFEST = 'releases/v0.1.1.json'
NOTES = 'releases/v0.1.1.md'
PROFILE = 'release; default features; diagnostic snippet features disabled'
GATES = {
    'ci': ('.github/workflows/ci.yml', {'CI Frontend Regression'}),
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
        if name == 'package':
            require(gate['qualification_commit'] == m['source_commit'] and gate['event'] in ('push', 'workflow_dispatch'), 'Packages must come from exact final main source')
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


def main():
    require(os.environ.get('GITHUB_REPOSITORY') == REPO and os.environ.get('GITHUB_REF') == 'refs/heads/release/v0.1.1', 'Only reviewed release branch may publish')
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
    require(comparison['status'] == 'ahead' and 0 < len(comparison.get('files', [])) <= 2 and {f['filename'] for f in comparison['files']} <= {MANIFEST, NOTES}, 'Publisher branch must only add frozen manifest/notes to main')
    require(all(f['status'] == 'added' for f in comparison['files']), 'Frozen release records must be new files')
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
    g.gh('release', 'create', TAG, '--repo', REPO, '--target', source, '--draft', '--title', 'InkLeet v0.1.1', '--notes-file', str(root / NOTES))
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
