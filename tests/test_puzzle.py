import unittest
from unittest.mock import patch
import chess
from app import server


class PuzzleSyncTests(unittest.TestCase):
    def test_puzzle_search_budgets_preserve_full_strength(self):
        for search, milliseconds in [(None, 2000), ('quick', 2000), ('deep', 10000)]:
            with self.subTest(search=search), patch.object(server, 'load_config', return_value={
                'engine': 'maia3', 'skill_level': 3, 'elo': 1500
            }), patch.object(server, 'active_engine') as engine:
                engine.return_value.analyse.return_value = {'candidates': []}
                server.analyse({'fen': chess.STARTING_FEN, 'context': 'puzzle',
                                'effort': 'fast', 'puzzle_search': search})
                cfg = engine.call_args.args[0]
                self.assertEqual(cfg['time_ms'], milliseconds)
                self.assertEqual(cfg['engine'], 'stockfish')
                self.assertEqual(cfg['skill_level'], 20)
                self.assertIsNone(cfg['elo'])
                self.assertEqual(cfg['multipv'], 5)

    def test_rank_black_candidates_and_mark_only_proven_losses(self):
        board = chess.Board(); board.turn = chess.BLACK
        result = {'engine': 'stockfish', 'candidates': [
            {'uci': 'a7a6', 'score': {'cp': 10000, 'mate': 3}},
            {'uci': 'b7b6', 'score': {'cp': -100, 'mate': None}},
            {'uci': 'c7c6', 'score': {'cp': 800, 'mate': None}}]}
        server.rank_puzzle_candidates(board, result)
        self.assertEqual(result['recommended_uci'], 'b7b6')
        self.assertEqual([c['puzzle_forced_loss'] for c in result['candidates']], [False, False, True])

    def test_maia_estimates_are_not_proof_and_results_are_capped(self):
        result = {'engine': 'maia3', 'candidates': [
            {'uci': str(i), 'score': {'cp': -10000, 'mate': -1}} for i in range(7)]}
        server.rank_puzzle_candidates(chess.Board(), result)
        self.assertEqual(len(result['candidates']), 5)
        self.assertTrue(all(not c['puzzle_verified'] and not c['puzzle_forced_loss'] for c in result['candidates']))

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
