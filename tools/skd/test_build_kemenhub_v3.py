from __future__ import annotations

import unittest

from build_kemenhub_v3 import match_education, normalized, split_education_options


class KemenhubV3QualityTest(unittest.TestCase):
    def test_exact_education_is_parsed(self) -> None:
        value, status, confidence, issue = match_education("D-III MANAJEMEN LOGISTIK", "D-III MANAJEMEN LOGISTIK")
        self.assertEqual(value, "D-III MANAJEMEN LOGISTIK")
        self.assertEqual(status, "parsed")
        self.assertGreater(confidence, 0.95)
        self.assertEqual(issue, "")

    def test_truncated_education_is_auto_corrected(self) -> None:
        value, status, _, issue = match_education(
            "D-III MANAJEMEN TRANSPORTASI PERAIRAN",
            "D-III MANAJEMEN TRANSPORTASI PERAIRAN DARATAN",
        )
        self.assertEqual(value, "D-III MANAJEMEN TRANSPORTASI PERAIRAN DARATAN")
        self.assertEqual(status, "auto_corrected")
        self.assertIn("dinormalisasi", issue)

    def test_ambiguous_education_requires_review(self) -> None:
        _, status, _, issue = match_education(
            "S-1 TEKNIK",
            "S-1 TEKNIK SIPIL / S-1 TEKNIK MESIN",
        )
        self.assertEqual(status, "needs_review")
        self.assertIn("tidak cocok pasti", issue)

    def test_normalization_and_option_split(self) -> None:
        self.assertEqual(normalized("S-1 Teknik Sipil"), "S 1 TEKNIK SIPIL")
        self.assertEqual(
            split_education_options("S-1 TEKNIK SIPIL / D-IV TRANSPORTASI DARAT"),
            ["S-1 TEKNIK SIPIL", "D-IV TRANSPORTASI DARAT"],
        )


if __name__ == "__main__":
    unittest.main()
