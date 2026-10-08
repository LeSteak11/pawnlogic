import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from app.paths import migrate_legacy


class MigrationTests(unittest.TestCase):
    def test_wal_and_existing_destination(self):
        with tempfile.TemporaryDirectory() as folder:
            legacy, dest = Path(folder) / 'legacy', Path(folder) / 'user'
            (legacy / 'data').mkdir(parents=True)
            source = sqlite3.connect(legacy / 'data/games.db')
            try:
                source.execute('PRAGMA journal_mode=WAL')
                source.execute('CREATE TABLE sample (value TEXT)')
                source.execute("INSERT INTO sample VALUES ('preserved')")
                source.commit()
                (legacy / 'config.json').write_text('{"threads": 2}')
                migrate_legacy(legacy, dest)
                with closing(sqlite3.connect(dest / 'data/games.db')) as db:
                    self.assertEqual(db.execute('SELECT value FROM sample').fetchone()[0], 'preserved')
                (dest / 'config.json').write_text('{"threads": 8}')
                source.execute("INSERT INTO sample VALUES ('new legacy row')")
                source.commit()
                migrate_legacy(legacy, dest)
                self.assertEqual((dest / 'config.json').read_text(), '{"threads": 8}')
                with closing(sqlite3.connect(dest / 'data/games.db')) as db:
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM sample').fetchone()[0], 1)
                self.assertTrue((legacy / 'data/games.db').exists())
            finally:
                source.close()
