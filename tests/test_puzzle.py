import unittest
from unittest.mock import patch
import chess
from app import server


class PuzzleSyncTests(unittest.TestCase):
    def test_puzzle_source_is_separate_from_game(self):
        import time
        now = time.time()
        sources = {'p': {'kind': 'puzzle', 'at': now, 'active_at': now,
                         'fen': chess.STARTING_FEN, 'puzzleId': 'one'}}
        with patch.object(server, '_sources', sources), patch.object(server, '_sync', {'at': now}):
            server._pick_source()
            self.assertEqual(server._sync['at'], 0)
            result = server.puzzle_sync_get()
            self.assertTrue(result['connected'])
            self.assertEqual(result['puzzleId'], 'one')

    def test_expired_puzzle_is_disconnected(self):
        with patch.object(server, '_sources', {'p': {'kind': 'puzzle', 'at': 0, 'active_at': 0}}):
            self.assertFalse(server.puzzle_sync_get()['connected'])

    def test_no_puzzle_does_not_select_game(self):
        with patch.object(server, '_sources', {'g': {'kind': 'game'}}):
            self.assertEqual(server.puzzle_sync_get(), {'connected': False})
