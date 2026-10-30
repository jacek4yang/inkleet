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


def windows_token(pid, elevated=False):
    sid='S-1-5-21-100-200-300-1001'
    return {'user_sid':sid,'owner_sid':'S-1-5-32-544' if elevated else sid,'integrity_rid':12288 if elevated else 8192,'elevated':elevated,'admin_enabled':elevated,'sandbox_inert':False,'enabled_privileges':['SeChangeNotifyPrivilege'],'process_id':pid,'session_id':1}


def windows_acceptance():
    code='{11111111-1111-1111-1111-111111111111}'; old='{22222222-2222-2222-2222-222222222222}'; upgrade='{33333333-3333-3333-3333-333333333333}'
    prior_source='fbacb2041b83232a30a791965c58d93a7556a4ff'
    sid=windows_token(1)['user_sid']
    owners=[{'path':path,'owner_sid':sid} for path in (r'C:\owned',r'C:\data',r'C:\cache',r'C:\owned\WebView2 synthetic profile')]
    hosts={}
    for index,phase in enumerate(('prepare','fresh','legacy','upgraded')):
        hosts[phase]={'result':'PASS','phase':phase,'harnessCommit':SOURCE,'run':{'parent':windows_token(100,True),'child':windows_token(110+index),'mode':'same-user-LUA-medium','exited':True,'exit_code':0,'timed_out':False,'job_handle_closed':True,'job_tree_empty':True}}
    ui={}
    for index,phase in enumerate(('fresh','legacy','upgraded')):
        version='0.1.1' if phase=='legacy' else p.VERSION
        launches=[]; attempts=[]; node=hosts[phase]['run']['child']['process_id']
        for i in range(2 if phase=='upgraded' else 1):
            pid=200+index*10+i; browser=pid+100; port=20000+pid
            observed={'result':'PASS','inspector_token':windows_token(500+pid),'node_token':windows_token(node),'app_token':windows_token(pid),'owners':copy.deepcopy(owners),'processes':[{'pid':pid,'parent_pid':node,'session_id':1,'confirmed_exited':False,'name':'inkleet.exe','path':r'C:\owned\inkleet.exe','webview_file_version':None},{'pid':browser,'parent_pid':pid,'session_id':1,'confirmed_exited':False,'name':'msedgewebview2.exe','path':r'C:\runtime\msedgewebview2.exe','webview_file_version':'150.0.0.1'}],'listeners':[{'address':'127.0.0.1','port':port,'pid':browser,'owned':True}]}
            launches.append({'pid':pid,'nodePid':node,'port':port,'version':version,'url':'http://tauri.localhost/','webviewVersion':'WebView2/test','observedHost':observed,'initialObservedPids':[pid,browser],'closingObservedPids':[pid,browser],'finalObservedPids':[pid,browser],'teardown':{'result':'PASS','app_pid':pid,'port':port,'app_absent':True,'owned_processes_absent':True,'owned_pids':[pid,browser],'listener_absent':True}})
            attempts.append({'pid':pid,'node_pid':node,'port':port,'diagnostics':copy.deepcopy(observed),'exited':True,'exit_code':0})
        ui[phase]={'result':'PASS','phase':phase,'harnessCommit':SOURCE,'applicationSourceCommit':prior_source if phase=='legacy' else SOURCE,'nativeVersion':version,'normalClose':True,'assertions':list(p.WINDOWS_UI_ASSERTIONS[phase]),'launches':launches,'launch_attempts':attempts}
    payload={'result':'PASS','rule':p.WINDOWS_PAYLOAD_RULE,'built_sha256':'d'*64,'expected_sha256':'e'*64,'installed_sha256':'e'*64,'built_bytes':128,'expected_bytes':128,'installed_bytes':128,'marker_offset':16,'marker_count':1,'marker_bytes':27,'built_path':r'C:\build\inkleet.exe','installed_path':r'C:\owned\inkleet.exe','expected_path':None,'expected_origin':p.WINDOWS_PAYLOAD_ORIGIN}
    return {'hosts':hosts,'preflight':{'related_product_codes':[],'owned_paths':owners},'payloads':{'fresh':copy.deepcopy(payload),'upgraded':copy.deepcopy(payload)},'result':'PASS','source_commit':SOURCE,'version':p.VERSION,'runner':'windows-2025','msi_uncertain':False,'cleanup_errors':[],'stages':list(p.WINDOWS_STAGES),'prior':{'url':f'https://github.com/{p.REPO}/releases/download/v0.1.1/InkLeet-0.1.1-preview-fbacb2041b83-windows-x64.msi','sha256':'1246c47b6a814bb3c3d42ab4972c8ca6a52ecb3fd05d82dfd75000b6921f46e0','bytes':6885376,'source_commit':prior_source,'version':'0.1.1'},'ui':ui,'packages':{'current':{'productCode':code,'upgradeCode':upgrade,'version':p.VERSION,'name':'InkLeet'},'legacy':{'productCode':old,'upgradeCode':upgrade,'version':'0.1.1','name':'InkLeet'}}}


def windows_msi_lifecycle():
    old = windows_acceptance()
    current, legacy = copy.deepcopy(old['packages']['current']), copy.deepcopy(old['packages']['legacy'])
    current.update(path=r'C:\build\bundle\msi\InkLeet.msi', bytes=3, sha256=p.digest(b'abc'))
    legacy.update(path=r'C:\owned\InkLeet-0.1.1-preview-fbacb2041b83-windows-x64.msi', bytes=old['prior']['bytes'], sha256=old['prior']['sha256'])
    sid = windows_token(1)['user_sid']
    marker = SOURCE + ':' + '1' * 32
    named = 'notebook/lc-1/.solutions/rust/11111111111111111111111111111111'
    files = [('appData', name) for name in (
        '.inkleet-msi-fixture', 'notebook/lc-1/solution.rs', 'notebook/lc-1/notes.md',
        'notebook/lc-1/.solutions/rust/default.json', named + '/name.json', named + '/solution.rs',
        'notebook/lc-1/.inkleet-drafts/solution.rs.json', named + '/.inkleet-drafts/solution.rs.json',
        named + '/.inkleet-recovery/conflict-fixture.json', 'settings.json',
    )] + [('appCache', '.inkleet-msi-fixture'), ('appCache', 'fixture-cache.json')]
    directories = {(root, str(parent)) for root, name in files for parent in pathlib.PurePosixPath(name).parents}
    baseline = {
        'files': [{'root':root,'relative_path':name,'bytes':len(marker) if name=='.inkleet-msi-fixture' else 3,'sha256':p.digest(marker.encode() if name=='.inkleet-msi-fixture' else b'abc'),'owner_sid':sid} for root,name in sorted(files)],
        'directories': [{'root':root,'relative_path':name,'owner_sid':sid} for root,name in sorted(directories)],
    }
    states = [(5,-1),(-1,-1),(-1,5),(5,-1),(-1,-1)]
    related = [[current['productCode']],[],[legacy['productCode']],[current['productCode']],[]]
    packages = [current['path'],current['productCode'],legacy['path'],current['path'],current['productCode']]
    return {
        'schema':1,'scope':'installer-only-seeded-data','result':'PASS','source_commit':SOURCE,'source_tree':TREE,'version':p.VERSION,'runner':'windows-2025',
        'application_launched':False,'not_verified':list(p.WINDOWS_MSI_NOT_VERIFIED),'msi_uncertain':False,'cleanup_errors':[],
        'stages':list(p.WINDOWS_MSI_STAGES),'prior':copy.deepcopy(old['prior']),'packages':{'current':current,'legacy':legacy},'payloads':copy.deepcopy(old['payloads']),
        'preflight':{'states':{'current':-1,'legacy':-1},'related_product_codes':[],'no_processes':True,'current_user_sid':sid,'absent_paths':[r'C:\owned',r'C:\data',r'C:\cache']},
        'registrations':[{'stage':stage,'result':'PASS','states':dict(zip(('current','legacy'),states[i])),'expected_related':related[i][:],'related_product_codes':related[i][:]} for i,stage in enumerate(p.WINDOWS_MSI_STAGES)],
        'msi_operations':[{'label':stage,'result':'PASS','action':'/x' if i in (1,4) else '/i','package':packages[i],'log':'C:\\evidence\\'+stage+'-msi.log','pid':100+i,'exit_code':0,'uncertain':False} for i,stage in enumerate(p.WINDOWS_MSI_STAGES)],
        'synthetic':{'origin':'test-seeded-not-app-authored','marker':marker,'roots':[{'name':name,'path':path,'owner_sid':sid} for name,path in [('appData',r'C:\data'),('appCache',r'C:\cache')]],'baseline':baseline,'boundaries':[{'stage':stage,'result':'PASS','snapshot':copy.deepcopy(baseline)} for stage in p.WINDOWS_MSI_STAGES]},
    }


def archive(m, platform='windows', extra=None, metadata_changes=None, source=SOURCE):
    a=m['artifacts'][platform]
    metadata={'commit':SOURCE,'target':p.PLATFORMS[platform][1],'version':p.VERSION,'build_profile':p.PROFILE,'workflow_run':f"https://github.com/{p.REPO}/actions/runs/{m['gates']['package']['run_id']}",'developer_id_signed':False,'notarized':False}
    metadata.update({'mach_o_files':[{'architectures':['x86_64']}],'file':a['assets'][0]['name'],'sha256':a['assets'][0]['sha256'],'bytes':a['assets'][0]['bytes'],'app_pe':{'machine':0x8664,'optional_header_magic':0x20b,'bytes':128},'msi':{'template':'x64;1033','product_code':'{11111111-1111-1111-1111-111111111111}'}})
    if platform=='windows':metadata['msi_lifecycle_acceptance']=windows_msi_lifecycle()
    metadata.update(metadata_changes or {})
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as z:
        z.writestr('BUILD_INFO.json',json.dumps(metadata));z.writestr('SOURCE_COMMIT.txt',source+'\n')
        if platform=='windows':z.writestr('MSI_LIFECYCLE_RESULT.json',json.dumps(metadata.get('msi_lifecycle_acceptance')))
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
    def reject(self, mutate):
        report=windows_acceptance();mutate(report)
        with self.assertRaises(ValueError):p.validate_windows_install(manifest(),self.metadata(),report)
    def reject_observation(self, mutate):
        def change(report):
            mutate(report)
            # Keep duplicated evidence consistent so each negative reaches its
            # intended security/provenance guard, not the final copy comparison.
            for phase in report['ui'].values():
                for launch, attempt in zip(phase['launches'], phase['launch_attempts']):
                    attempt['diagnostics']=copy.deepcopy(launch['observedHost'])
        self.reject(change)
    def test_already_standard_host_needs_no_token_change(self):
        report=windows_acceptance()
        for host in report['hosts'].values():
            host['run']['parent']=windows_token(100);host['run']['mode']='already-standard-no-token-change'
        p.validate_windows_install(manifest(),self.metadata(),report)
    def test_all_owned_host_phases_source_and_exit_required(self):
        for phase in ('prepare','fresh','legacy','upgraded'):
            self.reject(lambda r:r['hosts'].pop(phase))
        for change in ({'result':'FAIL'},{'harnessCommit':'f'*40},{'phase':'other'}):
            self.reject(lambda r:r['hosts']['fresh'].update(change))
        for change in ({'exited':False},{'exit_code':1},{'exit_code':False},{'timed_out':True},{'job_handle_closed':False},{'job_tree_empty':False},{'mode':'force-standard'}):
            self.reject(lambda r:r['hosts']['fresh']['run'].update(change))
    def test_standard_token_requires_observed_identity_security_and_session(self):
        for change in ({'user_sid':'S-1-5-21-1-2-3-4'},{'owner_sid':'S-1-5-32-544'},{'session_id':2},{'session_id':True},{'integrity_rid':12288},{'elevated':True},{'admin_enabled':True},{'sandbox_inert':True},{'elevated':0},{'enabled_privileges':['SeDebugPrivilege']},{'enabled_privileges':None},{'process_id':0}):
            with self.subTest(change=change):self.reject(lambda r:r['hosts']['fresh']['run']['child'].update(change))
        self.reject(lambda r:r['hosts']['fresh']['run'].update(mode='already-standard-no-token-change'))
        self.reject(lambda r:r['hosts']['fresh']['run']['parent'].update(integrity_rid=8192))
        self.reject(lambda r:r['hosts']['fresh']['run']['parent'].update(sandbox_inert=True))
        self.reject(lambda r:r['hosts']['fresh']['run']['parent'].update(session_id=2))
    def test_path_ownership_and_preexisting_product_refusal_required(self):
        for mutate in (lambda r:r.pop('preflight'),lambda r:r['preflight'].update(related_product_codes=['existing']),lambda r:r['preflight']['owned_paths'].pop(),lambda r:r['preflight']['owned_paths'][0].update(owner_sid='S-1-5-32-544'),lambda r:r['preflight']['owned_paths'][0].update(path=r'C:\owned\..\foreign'),lambda r:r['preflight']['owned_paths'][0].update(path=r'\\server\share'),lambda r:r['preflight']['owned_paths'].__setitem__(1,copy.deepcopy(r['preflight']['owned_paths'][0]))):
            self.reject(mutate)
    def test_launch_tokens_must_match_host_and_exact_app(self):
        for key in ('inspector_token','node_token','app_token'):
            self.reject_observation(lambda r:r['ui']['fresh']['launches'][0]['observedHost'][key].update(elevated=True))
        for change in ({'nodePid':999},{'pid':999},{'port':0},{'port':True}):
            self.reject(lambda r:r['ui']['fresh']['launches'][0].update(change))
        self.reject_observation(lambda r:r['ui']['fresh']['launches'][0]['observedHost']['app_token'].update(process_id=999))
        self.reject_observation(lambda r:r['ui']['fresh']['launches'][0]['observedHost']['owners'][0].update(path=r'C:\foreign'))
    def test_cdp_requires_owned_loopback_listener_and_runtime(self):
        for change in ({'address':'0.0.0.0'},{'address':'::'},{'pid':999},{'owned':False},{'port':1234}):
            self.reject_observation(lambda r:r['ui']['fresh']['launches'][0]['observedHost']['listeners'][0].update(change))
        for key in ('listeners','processes'):
            self.reject_observation(lambda r:r['ui']['fresh']['launches'][0]['observedHost'].update({key:[]}))
        self.reject_observation(lambda r:r['ui']['fresh']['launches'][0]['observedHost']['processes'][1].update(webview_file_version=None))
    def test_foreign_cyclic_or_duplicate_descendants_fail(self):
        for change in ({'parent_pid':999},{'parent_pid':300},{'session_id':2},{'session_id':True},{'confirmed_exited':None},{'confirmed_exited':True},{'pid':200}):
            self.reject_observation(lambda r:r['ui']['fresh']['launches'][0]['observedHost']['processes'][1].update(change))
        self.reject_observation(lambda r:r['ui']['fresh']['launches'][0]['observedHost']['processes'][0].update(parent_pid=999))
    def test_running_app_path_is_bound_to_verified_installed_payload(self):
        for phase in ('fresh','legacy','upgraded'):
            for change in ({'path':r'C:\foreign\inkleet.exe'},{'path':None},{'name':'other.exe'}):
                self.reject_observation(lambda r:r['ui'][phase]['launches'][0]['observedHost']['processes'][0].update(change))
    def test_actual_app_listener_and_descendant_teardown_required(self):
        for change in ({'result':'FAIL'},{'app_absent':False},{'listener_absent':False},{'owned_processes_absent':False},{'app_pid':999},{'port':1},{'owned_pids':[200]}):
            self.reject(lambda r:r['ui']['fresh']['launches'][0]['teardown'].update(change))
        self.reject(lambda r:r['ui']['fresh']['launches'][0].update(initialObservedPids=[]))
        self.reject(lambda r:r['ui']['fresh']['launches'][0].update(closingObservedPids=[200,300,400]))
        for pids in ([],[200],[200,200,300],[200,True,300],[300,200]):
            self.reject(lambda r:r['ui']['fresh']['launches'][0].update(finalObservedPids=pids))
    def test_attempts_cannot_hide_failed_retries_or_uncertain_close(self):
        for change in ({'pid':999},{'node_pid':999},{'port':1},{'exited':False},{'exit_code':1},{'exit_code':False},{'diagnostics':None}):
            self.reject(lambda r:r['ui']['fresh']['launch_attempts'][0].update(change))
        self.reject(lambda r:r['ui']['fresh'].update(launch_attempts=[]))
        self.reject(lambda r:r['ui']['fresh']['launch_attempts'].append(copy.deepcopy(r['ui']['fresh']['launch_attempts'][0])))
        self.reject(lambda r:r['ui']['fresh'].update(cleanupError='failed'))
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


class WindowsMsiLifecycleTest(unittest.TestCase):
    def metadata(self):return {'app_pe':{'bytes':128},'msi':{'product_code':'{11111111-1111-1111-1111-111111111111}'}}
    def validate(self, report):p.validate_windows_msi_lifecycle(manifest(),self.metadata(),report)
    def reject(self, mutate):
        report=windows_msi_lifecycle();mutate(report)
        with self.assertRaises(ValueError):self.validate(report)
    def test_complete_installer_only_evidence_passes(self):self.validate(windows_msi_lifecycle())
    def test_gui_report_cannot_substitute_for_installer_report(self):
        with self.assertRaises(ValueError):self.validate(windows_acceptance())
        for key in ('ui','hosts','installed_msi_acceptance'):
            self.reject(lambda r:r.update({key:{}}))
    def test_missing_failed_wrong_scope_source_tree_or_version_fails(self):
        for change in ({'schema':True},{'schema':2},{'scope':'GUI'}, {'result':'FAIL'},{'result':'SKIP'},{'source_commit':'e'*40},{'source_tree':'e'*40},{'version':'0.1.1'},{'runner':'windows-2022'},{'msi_uncertain':True},{'msi_uncertain':0},{'cleanup_errors':['error']},{'error':'prior failure'}):
            with self.subTest(change=change):self.reject(lambda r:r.update(change))
        with self.assertRaises(ValueError):self.validate(None)
        for key in ('source_tree','msi_uncertain','cleanup_errors','schema'):
            self.reject(lambda r:r.pop(key))
    def test_runtime_gap_must_be_explicit_and_app_not_launched(self):
        for value in (True,0,None):self.reject(lambda r:r.update(application_launched=value))
        self.reject(lambda r:r.pop('application_launched'))
        for values in ([],['not tested'],p.WINDOWS_MSI_NOT_VERIFIED[:-1]):
            self.reject(lambda r:r.update(not_verified=values))
        self.reject(lambda r:r['synthetic'].update(origin='v0.1.1-app-authored'))
    def test_all_exact_stages_required_in_order(self):
        for key in ('stages','registrations','msi_operations'):
            self.reject(lambda r:r[key].pop())
            self.reject(lambda r:r[key].reverse())
            self.reject(lambda r:r[key].append(copy.deepcopy(r[key][0])))
        self.reject(lambda r:r.update(stages=['install']*5))
    def test_exact_registered_and_removed_states_required(self):
        for index in range(5):
            for field in ('current','legacy'):
                self.reject(lambda r:r['registrations'][index]['states'].update({field:1}))
            for key in ('expected_related','related_product_codes'):
                self.reject(lambda r:r['registrations'][index][key].append('{99999999-9999-9999-9999-999999999999}'))
            self.reject(lambda r:r['registrations'][index].update(stage='wrong'))
            self.reject(lambda r:r['registrations'][index].update(result='FAIL'))
        self.reject(lambda r:r['registrations'][0].pop('states'))
    def test_operations_must_finish_without_retry_or_uncertainty(self):
        for index in range(5):
            for change in ({'result':'FAIL'},{'action':'/repair'},{'label':'other'},{'package':'foreign'},{'pid':0},{'pid':True},{'exit_code':False},{'exit_code':3010},{'uncertain':True},{'uncertain':0},{'error':'prior failure'},{'log':None}):
                with self.subTest(index=index,change=change):self.reject(lambda r:r['msi_operations'][index].update(change))
        self.reject(lambda r:r['msi_operations'][1].update(log=r['msi_operations'][0]['log']))
    def test_preflight_cannot_adopt_existing_data_or_products(self):
        for change in ({'states':{'current':5,'legacy':-1}},{'states':{'current':-1,'legacy':1}},{'related_product_codes':['existing']},{'no_processes':False},{'current_user_sid':'S-1-5-32-544'},{'absent_paths':[]}):
            self.reject(lambda r:r['preflight'].update(change))
        self.reject(lambda r:r['preflight']['absent_paths'].__setitem__(0,r'C:\foreign'))
        self.reject(lambda r:r['preflight']['absent_paths'].__setitem__(1,r['preflight']['absent_paths'][0]))
    def test_public_upgrade_baseline_must_match_pinned_bytes_and_identity(self):
        for change in ({'source_commit':SOURCE},{'sha256':'f'*64},{'bytes':1},{'version':'0.1.0'},{'url':'https://example.test/old.msi'}):
            self.reject(lambda r:r['prior'].update(change))
        for change in ({'sha256':'f'*64},{'bytes':1},{'version':p.VERSION},{'upgradeCode':'{99999999-9999-9999-9999-999999999999}'},{'productCode':None}):
            self.reject(lambda r:r['packages']['legacy'].update(change))
        self.reject(lambda r:r['packages']['legacy'].update(productCode=r['packages']['current']['productCode']))
    def test_same_guid_with_different_case_is_not_a_major_upgrade(self):
        report=windows_msi_lifecycle();current=report['packages']['current']['productCode'];legacy=report['packages']['legacy']['productCode']
        code='{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}'
        report=json.loads(json.dumps(report).replace(current,code).replace(legacy,code.lower()))
        metadata=self.metadata();metadata['msi']['product_code']=code
        with self.assertRaisesRegex(ValueError,'major-upgrade identity'):
            p.validate_windows_msi_lifecycle(manifest(),metadata,report)
    def test_current_installed_msi_is_bound_to_frozen_asset(self):
        for change in ({'sha256':'f'*64},{'bytes':4},{'bytes':True},{'version':'0.1.1'},{'productCode':'{99999999-9999-9999-9999-999999999999}'},{'name':'Other'},{'upgradeCode':'invalid'}):
            self.reject(lambda r:r['packages']['current'].update(change))
        self.reject(lambda r:r['packages'].pop('current'))
    def test_actual_paths_are_local_and_owned_fixture_is_not_overlapping(self):
        for value in ('relative.msi',r'\\host\share\file.msi',r'C:\owned\..\foreign.msi',''):
            self.reject(lambda r:r['packages']['current'].update(path=value))
        self.reject(lambda r:r['packages']['current'].update(path=r['packages']['legacy']['path']))
        self.reject(lambda r:r['synthetic']['roots'][1].update(path=r['synthetic']['roots'][0]['path']))
        self.reject(lambda r:r['synthetic']['roots'][1].update(path=r'C:\data\nested'))
        self.reject(lambda r:r['payloads']['fresh'].update(installed_path=r'C:\foreign\inkleet.exe'))
        def parent_escape(report):
            for payload in report['payloads'].values():payload['installed_path']=r'C:\owned\..\foreign\inkleet.exe'
        self.reject(parent_escape)
    def test_complete_seeded_tree_is_mandatory(self):
        for key in ('files','directories'):
            self.reject(lambda r:r['synthetic']['baseline'][key].pop())
            self.reject(lambda r:r['synthetic']['baseline'][key].append(copy.deepcopy(r['synthetic']['baseline'][key][0])))
        for change in ({'root':'foreign'},{'relative_path':'../foreign'},{'bytes':0},{'bytes':True},{'sha256':'short'},{'owner_sid':None}):
            self.reject(lambda r:r['synthetic']['baseline']['files'][0].update(change))
        self.reject(lambda r:r['synthetic']['baseline']['directories'][0].update(owner_sid=None))
        self.reject(lambda r:r['synthetic'].update(baseline={'files':[],'directories':[]}))
        self.reject(lambda r:r['synthetic']['roots'].pop())
    def test_marker_is_source_bound_and_hash_verified(self):
        for marker in ('x',('f'*40)+':'+('1'*32),SOURCE+':bad'):
            self.reject(lambda r:r['synthetic'].update(marker=marker))
        self.reject(lambda r:r['synthetic']['baseline']['files'][0].update(sha256='f'*64))
        self.reject(lambda r:r['synthetic']['roots'][0].update(owner_sid='not-a-sid'))
    def test_every_boundary_preserves_all_seeded_bytes_paths_and_owners(self):
        self.reject(lambda r:r['synthetic']['boundaries'].pop())
        self.reject(lambda r:r['synthetic']['boundaries'].reverse())
        for index in range(5):
            for change in ({'result':'FAIL'},{'stage':'skipped'},{'snapshot':None}):
                self.reject(lambda r:r['synthetic']['boundaries'][index].update(change))
            self.reject(lambda r:r['synthetic']['boundaries'][index]['snapshot']['files'][0].update(sha256='f'*64))
            self.reject(lambda r:r['synthetic']['boundaries'][index]['snapshot']['files'][0].update(bytes=1))
            self.reject(lambda r:r['synthetic']['boundaries'][index]['snapshot']['files'].pop())
            self.reject(lambda r:r['synthetic']['boundaries'][index]['snapshot']['directories'][0].update(owner_sid='S-1-5-32-544'))
    def test_exact_installed_payload_rule_remains_mandatory(self):
        for phase in ('fresh','upgraded'):
            for change in ({'installed_sha256':'f'*64},{'marker_count':2},{'marker_offset':True},{'expected_bytes':1},{'rule':'normalize-PE'},{'expected_origin':'arbitrary copy'}):
                self.reject(lambda r:r['payloads'][phase].update(change))
            self.reject(lambda r:r['payloads'].pop(phase))
    def test_archive_requires_equal_dedicated_report_no_old_gui_claim(self):
        for metadata in ({'msi_lifecycle_acceptance':None},{'installed_msi_acceptance':windows_acceptance()}):
            m=manifest();info,data=archive(m,metadata_changes=metadata)
            with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)
        wrong_type=windows_msi_lifecycle();wrong_type['application_launched']=0
        for replacement in (None,json.dumps({'result':'PASS'}),json.dumps(wrong_type)):
            m=manifest();info,data=archive(m)
            original=zipfile.ZipFile(io.BytesIO(data));stream=io.BytesIO()
            with zipfile.ZipFile(stream,'w') as z:
                for item in original.infolist():
                    if item.filename!='MSI_LIFECYCLE_RESULT.json':z.writestr(item,original.read(item.filename))
                if replacement is not None:z.writestr('MSI_LIFECYCLE_RESULT.json',replacement)
            data=stream.getvalue();info['digest']='sha256:'+p.digest(data);m['artifacts']['windows']['sha256']=p.digest(data)
            with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)
        m=manifest();info,data=archive(m,extra=lambda z:z.writestr('MSI_INSTALLED_RESULT.json','{}'))
        with self.assertRaises(ValueError):p.inspect_archive(m,'windows',info,data)


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
