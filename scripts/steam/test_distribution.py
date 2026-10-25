import gzip
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest
from publish_branch import package

spec=importlib.util.spec_from_file_location('steam_snapshot',pathlib.Path(__file__).resolve().parents[2]/'deploy/steam_snapshot.py')
sync=importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class DistributionChecks(unittest.TestCase):
    def test_manifest_requires_exact_file_allowlist(self):
        with self.assertRaisesRegex(ValueError,'unexpected package files'):
            sync.install(pathlib.Path('.'),{'files':{}},{})
        with self.assertRaisesRegex(ValueError,'unexpected package files'):
            sync.install(pathlib.Path('.'),{'files':{'../outside':{}}},{'../outside':b''})

    def test_compressed_bomb_is_bounded(self):
        with self.assertRaisesRegex(ValueError,'budget'):
            sync.unpack(gzip.compress(b'x'*10000),100)

    def test_private_package_install_and_tamper_preserve_previous_snapshot(self):
        with tempfile.TemporaryDirectory(prefix='appgap-distribution-') as temporary:
            root=pathlib.Path(temporary)
            source=root/'source';target=root/'target';output=root/'payload'
            source.mkdir();target.mkdir()
            data={'schemaVersion':1,'runId':1,'capturedAt':'2026-10-25T08:00:00+00:00','countries':[{'id':str(i)} for i in range(26)],'games':{str(i):{'type':0} for i in range(50)},'ranks':[{'country':'GLOBAL','chart':'sales','appId':str(i),'rank':i+1} for i in range(50)],'reviewCoverage':{'targeted':50,'succeeded':49}}
            (source/'latest.json').write_text(json.dumps(data),encoding='utf-8')
            db=sqlite3.connect(source/'history.sqlite')
            db.execute('CREATE TABLE runs(id INTEGER PRIMARY KEY,status TEXT,payload TEXT)')
            db.execute('INSERT INTO runs VALUES(?,?,?)',(1,'success',json.dumps(data)))
            db.commit();db.close()
            manifest=package(source,output)
            files={name:(output/name).read_bytes() for name in manifest['files']}
            sync.install(target,manifest,files)
            previous=(target/'latest.json').read_bytes()
            self.assertEqual(json.loads(previous),data)
            files['latest.json.gz']=b'broken'
            with self.assertRaisesRegex(ValueError,'checksum'):
                sync.install(target,manifest,files)
            self.assertEqual((target/'latest.json').read_bytes(),previous)
