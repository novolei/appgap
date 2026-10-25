import gzip
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from publish_branch import package

spec=importlib.util.spec_from_file_location('steam_sync',pathlib.Path(__file__).resolve().parents[2]/'deploy/sync-steam.py')
sync=importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class DistributionChecks(unittest.TestCase):
    def test_encrypted_dns_rejects_private_addresses_and_keeps_endpoint_pinning_separate(self):
        answer=json.dumps({'Status':0,'Answer':[{'type':1,'data':'127.0.0.1'},{'type':1,'data':'140.82.114.36'}]}).encode()
        with patch.object(sync.subprocess,'check_output',side_effect=[b'{"Status":2}',answer,answer]) as request, patch.object(sync.time,'sleep'):
            self.assertEqual(sync.github_addresses(),['140.82.114.36'])
            self.assertTrue(all(call.args[0][0]=='curl' for call in request.call_args_list))
        with patch.object(sync.subprocess,'check_output',return_value=b'{"Status":0,"Answer":[]}'), patch.object(sync.time,'sleep'):
            with self.assertRaisesRegex(ValueError,'did not return'):
                sync.github_addresses()

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
