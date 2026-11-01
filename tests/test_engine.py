import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import chess

from app import engine


class LastChoice:
    def __init__(self):
        self.population = None
        self.weights = None

    def choices(self, population, weights, k):
        self.population = population
        self.weights = weights
        return [population[-1]]


class EngineSettingsTests(unittest.TestCase):
    def test_integer_settings_accept_any_whole_number(self):
        html = (Path(__file__).parents[1] / "app" / "static" / "index.html").read_text(
            encoding="utf-8"
        )
        for field_name in (
            "maia_opponent_elo", "time_ms", "nodes", "hash_mb",
        ):
            self.assertRegex(html, rf'name="{field_name}"[^>]*step="1"')

    def test_main_screen_owns_strength_variety_and_effort(self):
        html = (Path(__file__).parents[1] / "app" / "static" / "index.html").read_text(
            encoding="utf-8"
        )
        self.assertIn('id="playing-strength"', html)
        self.assertIn('id="calculation-effort"', html)
        self.assertIn('id="profile-variety"', html)
        self.assertNotIn('id="stockfish-strength-mode"', html)

    def test_mate_distance_is_preserved_for_finish_policy(self):
        score = chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE)
        self.assertEqual(engine.fmt_score(score)["mate"], 3)

    def test_finish_policy_prefers_shortest_win_and_longest_resistance(self):
        board = chess.Board()
        winning = [
            {"uci": "e2e4", "quality_score": {"mate": 4}},
            {"uci": "d2d4", "quality_score": {"mate": 2}},
        ]
        self.assertEqual(engine.forced_finish_choice(board, winning),
                         ("d2d4", "Shortest proven mate · M2"))
        losing = [
            {"uci": "e2e4", "quality_score": {"mate": -2}},
            {"uci": "d2d4", "quality_score": {"mate": -5}},
        ]
        self.assertEqual(engine.forced_finish_choice(board, losing),
                         ("d2d4", "Longest resistance · M5"))

    def test_maia_modes_apply_expected_sampling_options(self):
        cfg = dict(engine.DEFAULT_CONFIG)
        cfg["maia_recommendation"] = "likely"
        self.assertEqual(engine.maia_options(cfg)["Temperature"], "0.0")
        self.assertEqual(engine.maia_options(cfg)["TopP"], "1.0")

        cfg["maia_recommendation"] = "natural"
        self.assertEqual(engine.maia_options(cfg)["Temperature"], "1.0")
        self.assertEqual(engine.maia_options(cfg)["TopP"], "0.95")

        cfg.update(maia_recommendation="custom", maia_temperature=1.4, maia_top_p=0.72)
        self.assertEqual(engine.maia_options(cfg)["Temperature"], "1.4")
        self.assertEqual(engine.maia_options(cfg)["TopP"], "0.72")

    def test_nodes_are_a_real_stockfish_search_limit(self):
        cfg = {**engine.DEFAULT_CONFIG, "mode": "nodes", "nodes": 12345}
        self.assertEqual(engine.search_limit(cfg).nodes, 12345)

    def test_bounded_variety_never_includes_move_past_ceiling(self):
        board = chess.Board()
        candidates = [
            {"uci": "e2e4", "score": {"cp": 60}},
            {"uci": "d2d4", "score": {"cp": 20}},
            {"uci": "a2a3", "score": {"cp": -80}},
        ]
        cfg = {**engine.DEFAULT_CONFIG, "stockfish_max_loss_cp": 50,
               "stockfish_variety_temperature": 30}
        rng = LastChoice()
        move, loss = engine.bounded_stockfish_choice(board, candidates, cfg, rng)
        self.assertEqual(move, "d2d4")
        self.assertEqual(loss, 40)
        self.assertEqual([item[0]["uci"] for item in rng.population], ["e2e4", "d2d4"])

    def test_bounded_variety_uses_side_to_move(self):
        board = chess.Board()
        board.push_uci("e2e4")
        candidates = [
            {"uci": "e7e5", "score": {"cp": 35}},
            {"uci": "c7c5", "score": {"cp": -15}},
        ]
        cfg = {**engine.DEFAULT_CONFIG, "stockfish_max_loss_cp": 20}
        move, loss = engine.bounded_stockfish_choice(board, candidates, cfg, LastChoice())
        self.assertEqual((move, loss), ("c7c5", 0))

    def test_maia_keeps_a_sampled_move_outside_ranked_candidates(self):
        cfg = {**engine.DEFAULT_CONFIG, "maia_recommendation": "custom"}
        candidates = [{"uci": "e2e4", "score": {"cp": 0}}]
        move, mode = engine.Maia3Engine().recommendation(
            chess.Board(), candidates, chess.Move.from_uci("a2a3"), cfg)
        self.assertEqual((move, mode), ("a2a3", "sampled"))

    def test_save_config_validates_and_persists_new_fields(self):
        with tempfile.TemporaryDirectory() as folder:
            config_path = Path(folder) / "config.json"
            with patch.object(engine, "CONFIG_PATH", config_path):
                saved = engine.save_config({
                    "engine": "stockfish", "mode": "nodes", "nodes": 75000,
                    "stockfish_variety": "bounded", "stockfish_max_loss_cp": 65,
                    "stockfish_variety_temperature": 45, "continuation_moves": 4,
                    "hybrid_guard": False,
                })
                self.assertEqual(saved["nodes"], 75000)
                self.assertEqual(saved["stockfish_variety"], "bounded")
                self.assertEqual(saved["continuation_moves"], 4)
                self.assertFalse(saved["hybrid_guard"])
                self.assertTrue(config_path.exists())


if __name__ == "__main__":
    unittest.main()
