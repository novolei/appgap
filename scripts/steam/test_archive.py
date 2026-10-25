import hashlib,io,json,tarfile,tempfile,unittest
from pathlib import Path
from check_archive import check_archive

class ArchiveChecks(unittest.TestCase):
    def test_receipts_match_and_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='appgap-archive-') as temporary:
            root=Path(temporary);raw=b'source';archive=root/'raw.tar.gz'
            (root/'latest.json').write_text(json.dumps({'runId':4,'sources':[{'label':'chart-GLOBAL','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}]}))
            def write(name,value):
                with tarfile.open(archive,'w:gz') as out:
                    member=tarfile.TarInfo(name);member.size=len(value);out.addfile(member,io.BytesIO(value))
            write('raw/4/chart-GLOBAL.html',raw)
            self.assertEqual(check_archive(root,archive),1)
            write('raw/4/chart-GLOBAL.html',b'broken')
            with self.assertRaisesRegex(ValueError,'checksum'):check_archive(root,archive)
            write('raw/3/chart-GLOBAL.html',raw)
            with self.assertRaisesRegex(ValueError,'path'):check_archive(root,archive)
