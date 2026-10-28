"""Pure publisher validation tests: no network and no release mutations."""
import copy
import hashlib
import importlib.util
import io
import json
import pathlib
import stat
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
        m['artifacts'][platform]={'id':200+i,'name':prefix+SOURCE,'sha256':'d'*64,'assets':[{'name':f'InkLeet-0.1.1-{SOURCE[:12]}-{arch}{ext}','bytes':3,'sha256':p.digest(b'abc')} for ext in extensions]}
    return m


def archive(m, platform='windows', extra=None, metadata_changes=None, source=SOURCE):
    a=m['artifacts'][platform]
    metadata={'commit':SOURCE,'target':p.PLATFORMS[platform][1],'version':'0.1.1','build_profile':p.PROFILE,'workflow_run':f"https://github.com/{p.REPO}/actions/runs/{m['gates']['package']['run_id']}",'developer_id_signed':False,'notarized':False}
    metadata.update({'mach_o_files':[{'architectures':['x86_64']}],'file':a['assets'][0]['name'],'sha256':a['assets'][0]['sha256'],'bytes':a['assets'][0]['bytes'],'app_pe':{'machine':0x8664,'optional_header_magic':0x20b},'msi':{'template':'x64;1033'}})
    metadata.update(metadata_changes or {})
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as z:
        z.writestr('BUILD_INFO.json',json.dumps(metadata));z.writestr('SOURCE_COMMIT.txt',source+'\n')
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
        m=manifest();m['artifacts']['linux']['assets'][0]['name']='InkLeet-0.1.1-'+SOURCE[:12]+'-linux-arm64.tar.gz'
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

if __name__=='__main__':unittest.main()
