"""Pure publisher validation tests: no network and no release mutations."""
import copy
import hashlib
import importlib.util
import io
import json
import pathlib
import stat
import base64
import os
import subprocess
import tempfile
from unittest import mock
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('publisher', pathlib.Path(__file__).parents[1] / 'scripts/publish-verified-release.py')
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
SOURCE = 'a' * 40
TREE = 'b' * 40


def manifest():
    m = {'schema':1,'repository':p.REPO,'tag':p.TAG,'version':p.VERSION,'prerelease':False,'source_commit':SOURCE,'source_tree':TREE,'notes_sha256':'c'*64,
         'gates':{name:{'run_id':100+i,'attempt':1,'event':'push','qualification_commit':SOURCE} for i,name in enumerate(p.GATES)},'artifacts':{}}
    for i,(platform,(prefix,_,extensions)) in enumerate(p.PLATFORMS.items()):
        arch = {'windows':'windows-x64','linux':'linux-x86_64','macos':'macos-x86_64'}[platform]
        m['artifacts'][platform]={'id':200+i,'name':prefix+SOURCE,'sha256':'d'*64,'assets':[{'name':f'InkLeet-{p.VERSION}-{SOURCE[:12]}-{arch}{ext}','bytes':3,'sha256':p.digest(b'abc')} for ext in extensions]}
    return m


def windows_acceptance():
    code='{11111111-1111-1111-1111-111111111111}'; old='{22222222-2222-2222-2222-222222222222}'; upgrade='{33333333-3333-3333-3333-333333333333}'
    prior_source='fbacb2041b83232a30a791965c58d93a7556a4ff'
    ui={}
    for phase in ('fresh','legacy','upgraded'):
        version='0.1.1' if phase=='legacy' else p.VERSION
        ui[phase]={'result':'PASS','phase':phase,'harnessCommit':SOURCE,'applicationSourceCommit':prior_source if phase=='legacy' else SOURCE,'nativeVersion':version,'normalClose':True,'assertions':list(p.WINDOWS_UI_ASSERTIONS[phase]),'launches':[{'pid':10+i,'version':version,'url':'http://tauri.localhost/','webviewVersion':'WebView2/test'} for i in range(2 if phase=='upgraded' else 1)]}
    payload={'result':'PASS','rule':p.WINDOWS_PAYLOAD_RULE,'built_sha256':'d'*64,'expected_sha256':'e'*64,'installed_sha256':'e'*64,'built_bytes':128,'expected_bytes':128,'installed_bytes':128,'marker_offset':16,'marker_count':1,'marker_bytes':27,'built_path':r'C:\build\inkleet.exe','installed_path':r'C:\owned\inkleet.exe','expected_path':None,'expected_origin':p.WINDOWS_PAYLOAD_ORIGIN}
    return {'payloads':{'fresh':copy.deepcopy(payload),'upgraded':copy.deepcopy(payload)},'result':'PASS','source_commit':SOURCE,'version':p.VERSION,'runner':'windows-2025','msi_uncertain':False,'cleanup_errors':[],'stages':list(p.WINDOWS_STAGES),'prior':{'url':f'https://github.com/{p.REPO}/releases/download/v0.1.1/InkLeet-0.1.1-preview-fbacb2041b83-windows-x64.msi','sha256':'1246c47b6a814bb3c3d42ab4972c8ca6a52ecb3fd05d82dfd75000b6921f46e0','bytes':6885376,'source_commit':prior_source,'version':'0.1.1'},'ui':ui,'packages':{'current':{'productCode':code,'upgradeCode':upgrade,'version':p.VERSION,'name':'InkLeet'},'legacy':{'productCode':old,'upgradeCode':upgrade,'version':'0.1.1','name':'InkLeet'}}}


def archive(m, platform='windows', extra=None, metadata_changes=None, source=SOURCE):
    a=m['artifacts'][platform]
    metadata={'commit':SOURCE,'target':p.PLATFORMS[platform][1],'version':p.VERSION,'build_profile':p.PROFILE,'workflow_run':f"https://github.com/{p.REPO}/actions/runs/{m['gates']['package']['run_id']}",'developer_id_signed':False,'notarized':False}
    metadata.update({'mach_o_files':[{'architectures':['x86_64']}],'file':a['assets'][0]['name'],'sha256':a['assets'][0]['sha256'],'bytes':a['assets'][0]['bytes'],'app_pe':{'machine':0x8664,'optional_header_magic':0x20b,'bytes':128},'msi':{'template':'x64;1033','product_code':'{11111111-1111-1111-1111-111111111111}'}})
    if platform=='windows':metadata['installed_msi_acceptance']=windows_acceptance()
    metadata.update(metadata_changes or {})
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as z:
        z.writestr('BUILD_INFO.json',json.dumps(metadata));z.writestr('SOURCE_COMMIT.txt',source+'\n')
        if platform=='windows':z.writestr('MSI_INSTALLED_RESULT.json',json.dumps(metadata.get('installed_msi_acceptance')))
        for asset in a['assets']:z.writestr(asset['name'],b'abc')
        if extra:extra(z)
    data=stream.getvalue();a['sha256']=p.digest(data)
    info={'id':a['id'],'name':a['name'],'expired':False,'workflow_run':{'id':m['gates']['package']['run_id'],'head_sha':SOURCE},'digest':'sha256:'+a['sha256']}
    return info,data


class PublisherTest(unittest.TestCase):
    def test_frozen_manifest_valid(self):p.validate_manifest(manifest())

    def test_manifest_bad_identity(self):
        for key,value in [('repository','other/repo'),('tag','v0.1.0'),('version','0.1.0'),('source_commit','short'),('prerelease',True),('notes_sha256','bad')]:
            with self.subTest(key=key):
                m=manifest();m[key]=value
                with self.assertRaises(ValueError):p.validate_manifest(m)

    def test_exact_package_source(self):
        m=manifest();m['gates']['package']['qualification_commit']='c'*40
        with self.assertRaises(ValueError):p.validate_manifest(m)

    def test_every_gate_requires_exact_main_source(self):
        for name in p.GATES:
            with self.subTest(name=name):
                m=manifest();m['gates'][name]['qualification_commit']='c'*40
                with self.assertRaises(ValueError):p.validate_manifest(m)
                for event in ('pull_request', 'workflow_dispatch'):
                    m=manifest();m['gates'][name]['event']=event
                    with self.assertRaises(ValueError):p.validate_manifest(m)

    def test_pr_gate_rejected_even_with_same_head_tree(self):
        m,r,j=self.gate();r['event']='pull_request';m['gates']['native']['event']='pull_request'
        with self.assertRaises(ValueError):p.validate_gate(m,'native',r,j,TREE)

    def test_missing_gate(self):
        m=manifest();del m['gates']['native']
        with self.assertRaises(ValueError):p.validate_manifest(m)

    def test_wrong_architecture_name(self):
        m=manifest();m['artifacts']['linux']['assets'][0]['name']='InkLeet-'+p.VERSION+'-'+SOURCE[:12]+'-linux-arm64.tar.gz'
        with self.assertRaises(ValueError):p.validate_manifest(m)

    def test_missing_and_duplicate_formats(self):
        for mutation in (lambda a:a.pop(),lambda a:a.__setitem__(1,copy.deepcopy(a[0]))):
            m=manifest();mutation(m['artifacts']['windows']['assets'])
            with self.assertRaises(ValueError):p.validate_manifest(m)

    def gate(self):
        m=manifest();f=m['gates']['native']
        run={'id':f['run_id'],'run_attempt':1,'repository':{'full_name':p.REPO},'head_repository':{'full_name':p.REPO},'path':p.GATES['native'][0],'event':'push','head_sha':SOURCE,'head_branch':'main','status':'completed','conclusion':'success'}
        jobs=[{'name':'Native Linux Full Validation','run_id':run['id'],'status':'completed','conclusion':'success'}]
        return m,run,jobs

    def test_gate_valid(self):
        m,r,j=self.gate();p.validate_gate(m,'native',r,j,TREE)

    def test_gate_identity_failure(self):
        for key,value in [('id',9),('run_attempt',2),('path','.github/workflows/ci.yml'),('event','workflow_dispatch'),('head_sha','c'*40),('head_branch','other'),('status','in_progress'),('conclusion','failure')]:
            with self.subTest(key=key):
                m,r,j=self.gate();r[key]=value
                with self.assertRaises(ValueError):p.validate_gate(m,'native',r,j,TREE)

    def test_foreign_gate_and_wrong_tree(self):
        m,r,j=self.gate();r['head_repository']['full_name']='other/repo'
        with self.assertRaises(ValueError):p.validate_gate(m,'native',r,j,TREE)
        m,r,j=self.gate()
        with self.assertRaises(ValueError):p.validate_gate(m,'native',r,j,'d'*40)

    def test_missing_skipped_duplicate_jobs(self):
        for jobs in ([],[{'name':'Native Linux Full Validation','status':'completed','run_id':101,'conclusion':'skipped'}]):
            m,r,_=self.gate()
            with self.assertRaises(ValueError):p.validate_gate(m,'native',r,jobs,TREE)
        m,r,j=self.gate()
        with self.assertRaises(ValueError):p.validate_gate(m,'native',r,j+j,TREE)

    def test_each_platform_archive(self):
        for platform in p.PLATFORMS:
            m=manifest();info,data=archive(m,platform)
            files,_=p.inspect_archive(m,platform,info,data)
            self.assertEqual(len(files),len(p.PLATFORMS[platform][2]))

    def test_artifact_metadata_failures(self):
        for key,value in [('expired',True),('id',99),('name','other'),('digest','sha256:'+'0'*64)]:
            m=manifest();info,data=archive(m);info[key]=value
            with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)

    def test_artifact_wrong_run(self):
        m=manifest();info,data=archive(m);info['workflow_run']['id']=99
        with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)

    def test_embedded_source_and_profile(self):
        for change in ({'commit':'c'*40},{'target':'aarch64'},{'build_profile':'debug; snippet-enabled'},{'version':'0.1.0'},{'workflow_run':'wrong'}):
            m=manifest();info,data=archive(m,metadata_changes=change)
            with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)
        m=manifest();info,data=archive(m,source='c'*40)
        with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)

    def test_bad_asset_digest(self):
        m=manifest();info,data=archive(m);m['artifacts']['windows']['assets'][0]['sha256']='f'*64
        with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)

    def test_unsafe_zip_paths(self):
        for name in ('../escape','/absolute','dir/../../escape','C:/drive','dir\\file'):
            m=manifest();info,data=archive(m,extra=lambda z:z.writestr(name,'bad'))
            with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)

    def test_zip_symlink(self):
        def symlink(z):
            i=zipfile.ZipInfo('link');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'target')
        m=manifest();info,data=archive(m,extra=symlink)
        with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)

    def test_duplicate_members(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore');m=manifest();info,data=archive(m,extra=lambda z:z.writestr('SOURCE_COMMIT.txt',SOURCE))
        with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)

    def test_existing_draft_or_tag_cannot_be_republished(self):
        for releases,tags in ([{'tag_name':p.TAG}],[]),([],[{'name':p.TAG}]):
            with self.assertRaises(ValueError):p.require_absent(releases,tags)
        p.require_absent([],[])

    def test_expanded_zip_size_limit(self):
        import struct
        m=manifest();info,data=archive(m)
        data=bytearray(data);offset=data.index(b'PK\x01\x02')
        struct.pack_into('<I',data,offset+24,400*1024*1024)
        data=bytes(data);m['artifacts']['windows']['sha256']=p.digest(data);info['digest']='sha256:'+p.digest(data)
        with self.assertRaisesRegex(ValueError,'expanded'):p.inspect_archive(m,'windows',info,data)

    def test_partial_upload_never_verifies(self):
        with self.assertRaises(ValueError):p.verify_assets({'assets':[]},{'x':b'abc'},None)

    def test_changed_uploaded_bytes_fail(self):
        fake=type('Fake',(),{'binary':lambda self,path:b'bad'})()
        with self.assertRaises(ValueError):p.verify_assets({'assets':[{'id':1,'name':'x','size':3}]},{'x':b'abc'},fake)

    def test_exact_uploaded_bytes_pass(self):
        fake=type('Fake',(),{'binary':lambda self,path:b'abc'})()
        p.verify_assets({'assets':[{'id':1,'name':'x','size':3}]},{'x':b'abc'},fake)

class WindowsAcceptanceTest(unittest.TestCase):
    def metadata(self):return {'app_pe':{'bytes':128},'msi':{'product_code':'{11111111-1111-1111-1111-111111111111}'}}
    def test_valid_installed_native_evidence(self):p.validate_windows_install(manifest(),self.metadata(),windows_acceptance())
    def test_expected_stage_and_assertion_labels_match_actual_producers(self):
        root=pathlib.Path(__file__).parents[1]
        ps=(root/'scripts/test-windows-installed.ps1').read_text()
        js=(root/'tests/windows-installed-ui.mjs').read_text()
        payload=(root/'tests/windows-msi-payload.mjs').read_text()
        self.assertIn(p.WINDOWS_PAYLOAD_RULE,payload); self.assertIn(p.WINDOWS_PAYLOAD_ORIGIN,payload)
        for label in p.WINDOWS_STAGES:self.assertIn(label,ps)
        for labels in p.WINDOWS_UI_ASSERTIONS.values():
            for label in labels:self.assertIn(label,js)
    def test_placeholder_stages_assertions_and_invalid_guids_fail(self):
        for mutate in (lambda r:r.update(stages=['a','b','c','d','e']),lambda r:r['ui']['upgraded'].update(assertions=['executed']),lambda r:r['packages']['current'].update(upgradeCode='{------------------------------------}'),lambda r:r['packages']['legacy'].update(productCode=None)):
            report=windows_acceptance();mutate(report)
            with self.assertRaises(ValueError):p.validate_windows_install(manifest(),self.metadata(),report)
    def test_exact_payload_proofs_required(self):
        for payloads in ({}, {'fresh':windows_acceptance()['payloads']['fresh']}, None):
            report=windows_acceptance();report['payloads']=payloads
            with self.assertRaises(ValueError):p.validate_windows_install(manifest(),self.metadata(),report)
    def test_payload_marker_hash_size_and_origin_fail_closed(self):
        changes=[{'result':'FAIL'},{'rule':'normalize-PE'},{'built_sha256':'bad'},{'built_sha256':'e'*64},{'installed_sha256':'f'*64},{'expected_bytes':127},{'installed_bytes':129},{'built_bytes':True},{'marker_count':2},{'marker_count':True},{'marker_offset':-1},{'marker_offset':102},{'marker_offset':True},{'marker_bytes':25},{'built_path':''},{'installed_path':None},{'expected_path':'rewritten.exe'},{'expected_origin':'normalized arbitrary bytes'}]
        for change in changes:
            with self.subTest(change=change):
                report=windows_acceptance();report['payloads']['fresh'].update(change)
                with self.assertRaises(ValueError):p.validate_windows_install(manifest(),self.metadata(),report)
        report=windows_acceptance();report['payloads']['fresh'].pop('expected_path')
        with self.assertRaises(ValueError):p.validate_windows_install(manifest(),self.metadata(),report)
    def test_fresh_upgrade_and_inspected_payload_size_must_match(self):
        report=windows_acceptance();report['payloads']['upgraded']['built_sha256']='f'*64
        with self.assertRaises(ValueError):p.validate_windows_install(manifest(),self.metadata(),report)
        metadata=self.metadata();metadata['app_pe']['bytes']=129
        with self.assertRaises(ValueError):p.validate_windows_install(manifest(),metadata,windows_acceptance())
    def test_missing_failed_or_uncertain_installation_fails(self):
        for change in ({'result':'FAIL'},{'result':'SKIP'},{'source_commit':'c'*40},{'version':'0.1.0'},{'runner':'other'},{'msi_uncertain':True},{'cleanup_errors':['error']},{'stages':[]}):
            report=windows_acceptance();report.update(change)
            with self.assertRaises(ValueError):p.validate_windows_install(manifest(),self.metadata(),report)
        with self.assertRaises(ValueError):p.validate_windows_install(manifest(),self.metadata(),None)
    def test_prior_native_source_and_restart_provenance_cannot_be_inferred(self):
        for mutate in (lambda r:r['prior'].update(sha256='f'*64),lambda r:r['ui'].pop('legacy'),lambda r:r['ui']['legacy'].update(applicationSourceCommit=SOURCE),lambda r:r['ui']['upgraded'].update(normalClose=False),lambda r:r['ui']['upgraded'].update(launches=r['ui']['upgraded']['launches'][:1]),lambda r:r['ui']['fresh']['launches'][0].update(url='http://localhost:5173'),lambda r:r['packages']['current'].update(productCode='other')):
            report=windows_acceptance();mutate(report)
            with self.assertRaises(ValueError):p.validate_windows_install(manifest(),self.metadata(),report)


class PublisherIdentityTest(unittest.TestCase):
    def test_identity_follows_validated_application_version(self):
        self.assertEqual(p.TAG, 'v' + p.VERSION)
        self.assertEqual(p.MANIFEST, f'releases/{p.TAG}.json')
        self.assertEqual(p.NOTES, f'releases/{p.TAG}.md')

    def capture_transport(self, endpoint):
        calls=[]
        g=p.GitHub();g.gh=lambda *args:calls.append(args) or b'bytes'
        self.assertEqual(g.binary(endpoint), b'bytes')
        return calls

    def test_artifact_redirect_uses_default_api_accept(self):
        self.assertEqual(self.capture_transport('actions/artifacts/12815795589/zip'), [('api', 'repos/'+p.REPO+'/actions/artifacts/12815795589/zip')])

    def test_release_asset_keeps_octet_stream(self):
        self.assertEqual(self.capture_transport('releases/assets/123'), [('api', 'repos/'+p.REPO+'/releases/assets/123', '-H', 'Accept: application/octet-stream')])

    def test_unknown_binary_routes_fail_without_request(self):
        for endpoint in ('actions/artifacts/0/zip', 'releases/assets/1?x=2', 'https://evil.test', '../secrets'):
            g=p.GitHub();g.gh=lambda *args:self.fail('Unexpected network request')
            with self.assertRaises(ValueError):p.GitHub.binary(g, endpoint)

    def comparison(self):
        data={p.MANIFEST:b'manifest', p.NOTES:b'notes'}
        files=[]
        for name,b in data.items():
            blob=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
            files.append({'filename':name,'status':'added','sha':blob})
        return {'status':'ahead','files':files},data

    def test_only_two_new_exact_records_pass(self):
        comparison,data=self.comparison()
        p.validate_publisher_comparison(comparison,data.__getitem__)

    def test_old_recovery_exceptions_do_not_apply_to_new_releases(self):
        for recovery in ({}, {'scripts/publish-verified-release.py':'a'*64}, None):
            m=manifest();m['publisher_recovery']=recovery
            with self.assertRaises(ValueError):p.validate_manifest(m)

    def test_changed_checkout_fails(self):
        comparison,data=self.comparison();data[p.NOTES]+=b'changed'
        with self.assertRaises(ValueError):p.validate_publisher_comparison(comparison,data.__getitem__)

    def test_missing_extra_duplicate_modified_or_renamed_files_fail(self):
        for mutation in (lambda c:c['files'].pop(), lambda c:c['files'].append({'filename':'src/main.tsx','status':'modified','sha':'a'*40}), lambda c:c['files'].__setitem__(1,c['files'][0]), lambda c:c['files'][0].update(status='modified'), lambda c:c['files'][0].update(status='renamed'), lambda c:c.update(status='diverged')):
            comparison,data=self.comparison();mutation(comparison)
            with self.assertRaises(ValueError):p.validate_publisher_comparison(comparison,data.__getitem__)


class PublisherOrchestrationTest(unittest.TestCase):
    def execute(self, fault=None):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        root=pathlib.Path(temp.name);(root/'releases').mkdir();(root/'scripts').mkdir()
        m=manifest();archives={}
        for platform in p.PLATFORMS:
            info,data=archive(m,platform);archives[m['artifacts'][platform]['id']]=(info,data)
        notes=b'Frozen notes\n';m['notes_sha256']=p.digest(notes)
        (root/p.NOTES).write_bytes(notes)
        (root/p.MANIFEST).write_text(json.dumps(m))
        records=[]
        for name in (p.MANIFEST,p.NOTES):
            b=(root/name).read_bytes()
            records.append({'filename':name,'status':'added','sha':hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()})
        # Read a source identity, not the publisher's package metadata.
        package={'content':base64.b64encode(json.dumps({'version':p.VERSION}).encode()).decode()}
        test=self
        class FakeGitHub:
            def __init__(self):
                self.mutations=[];self.downloads=[];self.files={};self.main_reads=0
                self.release=None
            def get(self,endpoint):
                if endpoint=='git/ref/heads/main':
                    self.main_reads+=1
                    moved=(fault=='main-before-create' and self.main_reads>=2) or (fault=='main-before-publish' and self.main_reads>=3)
                    return {'object':{'sha':'e'*40 if moved else SOURCE}}
                if endpoint==f'git/commits/{SOURCE}':return {'tree':{'sha':TREE}}
                if endpoint==f'compare/{SOURCE}...'+('f'*40):return {'status':'ahead','files':records}
                if endpoint==f'contents/package.json?ref={SOURCE}':return package
                for name,gate in m['gates'].items():
                    if endpoint==f"actions/runs/{gate['run_id']}":
                        return {'id':gate['run_id'],'run_attempt':1,'repository':{'full_name':p.REPO},'head_repository':{'full_name':p.REPO},'path':p.GATES[name][0],'event':'push','head_sha':SOURCE,'head_branch':'main','status':'completed','conclusion':'failure' if fault=='gate-failure' else 'success'}
                for aid,(info,_) in archives.items():
                    if endpoint==f'actions/artifacts/{aid}':return {**info,'size_in_bytes':100}
                if endpoint=='releases/50' or endpoint==f'releases/tags/{p.TAG}':return self.release
                if endpoint==f'git/ref/tags/{p.TAG}':return {'object':{'type':'commit','sha':SOURCE}}
                test.fail('Unexpected GET '+endpoint)
            def pages(self,endpoint,key=None):
                if endpoint=='tags':return []
                if endpoint=='releases':return [] if self.release is None else [self.release]
                for name,gate in m['gates'].items():
                    if endpoint==f"actions/runs/{gate['run_id']}/attempts/1/jobs":
                        return [{'name':job,'run_id':gate['run_id'],'status':'completed','conclusion':'success'} for job in p.GATES[name][1]]
                test.fail('Unexpected pages '+endpoint)
            def binary(self,endpoint):
                self.downloads.append(endpoint)
                for aid,(_,data) in archives.items():
                    if endpoint==f'actions/artifacts/{aid}/zip':return data
                for asset in self.release['assets']:
                    if endpoint==f"releases/assets/{asset['id']}":
                        return b'corrupt' if fault=='published-corruption' and not self.release['draft'] else self.files[asset['name']]
                test.fail('Unexpected binary '+endpoint)
            def gh(self,*args):
                test.assertEqual(args[0],'release');operation=args[1]
                test.assertEqual(args[2],p.TAG)
                test.assertEqual(args[args.index('--repo')+1],p.REPO)
                self.mutations.append(operation)
                if operation=='create':
                    test.assertIn('--draft',args)
                    test.assertEqual(args[args.index('--target')+1],SOURCE)
                    test.assertEqual(args[args.index('--title')+1],f'InkLeet {p.TAG}')
                    self.release={'id':50,'tag_name':p.TAG,'draft':True,'prerelease':False,'target_commitish':SOURCE,'assets':[],'html_url':'https://github.com/'+p.REPO+'/releases/tag/'+p.TAG}
                elif operation=='upload':
                    paths=args[5:6] if fault in ('partial-upload','uncertain-upload') else args[5:]
                    for i,name in enumerate(paths):
                        path=pathlib.Path(name);data=path.read_bytes();self.files[path.name]=data
                        self.release['assets'].append({'id':300+i,'name':path.name,'size':len(data)})
                    if fault=='uncertain-upload':raise subprocess.CalledProcessError(1,['gh',*args])
                elif operation=='edit':
                    test.assertIn('--draft=false',args);test.assertIn('--prerelease=false',args)
                    test.assertEqual(len([d for d in self.downloads if d.startswith('releases/assets/')]),6,'Every draft asset must be downloaded before publication')
                    self.release['draft']=False;self.release['published_at']='2026-10-29T00:00:00Z'
                else:test.fail('Unexpected mutation '+operation)
                return b''
        fake=FakeGitHub();self.fake=fake
        with mock.patch.object(p,'__file__',str(root/'scripts/publish-verified-release.py')),mock.patch.object(p,'GitHub',return_value=fake),mock.patch.dict(os.environ,{'GITHUB_REPOSITORY':p.REPO,'GITHUB_REF':f'refs/heads/release/{p.TAG}','GITHUB_SHA':'f'*40}),mock.patch('builtins.print'):
            p.main()
        return fake

    def test_success_verifies_every_asset_before_and_after_one_shot_publish(self):
        fake=self.execute()
        self.assertEqual(fake.mutations,['create','upload','edit'])
        self.assertEqual(len([d for d in fake.downloads if d.startswith('releases/assets/')]),12)

    def test_gate_failure_never_mutates(self):
        with self.assertRaises(ValueError):self.execute('gate-failure')
        self.assertEqual(self.fake.mutations,[])

    def test_main_move_before_create_never_mutates(self):
        with self.assertRaises(ValueError):self.execute('main-before-create')
        self.assertEqual(self.fake.mutations,[])

    def test_main_move_after_upload_leaves_draft(self):
        with self.assertRaises(ValueError):self.execute('main-before-publish')
        self.assertEqual(self.fake.mutations,['create','upload'])
        self.assertTrue(self.fake.release['draft'])

    def test_uncertain_upload_is_not_retried_or_published(self):
        with self.assertRaises(subprocess.CalledProcessError):self.execute('uncertain-upload')
        self.assertEqual(self.fake.mutations,['create','upload'])
        self.assertTrue(self.fake.release['draft'])
        self.assertEqual(len(self.fake.release['assets']),1)

    def test_partial_upload_never_publishes(self):
        with self.assertRaises(ValueError):self.execute('partial-upload')
        self.assertEqual(self.fake.mutations,['create','upload'])

    def test_post_publication_mismatch_is_verification_failure_not_retry(self):
        with self.assertRaises(ValueError):self.execute('published-corruption')
        self.assertEqual(self.fake.mutations,['create','upload','edit'])
        self.assertFalse(self.fake.release['draft'])

if __name__=='__main__':unittest.main()
