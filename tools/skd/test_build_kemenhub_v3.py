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

    def test_small_ocr_omission_uses_the_nearest_complete_option(self) -> None:
        value, status, confidence, issue = match_education(
            "D-III REKAM MEDIS DA INFORMASI KESEHATAN",
            "D-III REKAM MEDIK DAN INFORMASI KESEHATAN / D-III REKAM MEDIS DAN INFORMASI KESEHATAN",
        )
        self.assertEqual(value, "D-III REKAM MEDIS DAN INFORMASI KESEHATAN")
        self.assertEqual(status, "auto_corrected")
        self.assertGreaterEqual(confidence, 0.96)
        self.assertIn("dinormalisasi", issue)

    def test_unique_truncated_education_is_auto_corrected(self) -> None:
        value, status, confidence, issue = match_education(
            "D-IV BAHASA INGGRI UNTUK KOMUNIKASI BISNIS DAN",
            "D-IV BAHASA INGGRIS UNTUK KOMUNIKASI BISNIS DAN PROFESIONAL / S-1 BAHASA INGGRIS",
        )
        self.assertEqual(
            value,
            "D-IV BAHASA INGGRIS UNTUK KOMUNIKASI BISNIS DAN PROFESIONAL",
        )
        self.assertEqual(status, "auto_corrected")
        self.assertGreaterEqual(confidence, 0.87)
        self.assertIn("dinormalisasi", issue)

    def test_truncated_token_and_suffix_are_completed(self) -> None:
        value, status, confidence, issue = match_education(
            "D-IV BAHASA INGGRI UNTUK KOMUNIKASI BISNIS DAN",
            "D-IV BAHASA INGGRIS UNTUK KOMUNIKASI BISNIS DAN PROFESIONAL / D-IV BAHASA JEPANG UNTUK KOMUNIKASI BISNIS DAN PROFESIONAL",
        )
        self.assertEqual(
            value,
            "D-IV BAHASA INGGRIS UNTUK KOMUNIKASI BISNIS DAN PROFESIONAL",
        )
        self.assertEqual(status, "auto_corrected")
        self.assertGreaterEqual(confidence, 0.97)
        self.assertIn("terpotong", issue)

    def test_degree_equivalent_education_uses_unique_formation_option(self) -> None:
        value, status, confidence, issue = match_education(
            "S-1 PENDIDIKAN AGAMA ISLAM",
            "S-1 AGAMA ISLAM / S-1 PENDIDIKAN KEAGAMAAN KRISTEN",
        )
        self.assertEqual(value, "S-1 AGAMA ISLAM")
        self.assertEqual(status, "auto_corrected")
        self.assertGreaterEqual(confidence, 0.96)
        self.assertIn("disetarakan", issue)

    def test_degree_equivalent_truncated_suffix_is_completed(self) -> None:
        value, status, confidence, issue = match_education(
            "S-1 PENDIDIKAN NONFORMAL ATAU PENDIDIKAN",
            "S-1 NONFORMAL ATAU PENDIDIKAN MASYARAKAT / S-1 PENDIDIKAN VOKASIONAL KESEJAHTERAAN KELUARGA",
        )
        self.assertEqual(value, "S-1 NONFORMAL ATAU PENDIDIKAN MASYARAKAT")
        self.assertEqual(status, "auto_corrected")
        self.assertGreaterEqual(confidence, 0.95)
        self.assertIn("terpotong", issue)

    def test_combined_degrees_match_separate_formation_options(self) -> None:
        value, status, confidence, issue = match_education(
            "D-IV / S-1 EKONOMI",
            "D-IV / S-1 EKONOMI / S-1 AKUNTANSI / S-1 MANAJEMEN",
        )
        self.assertEqual(value, "D-IV / S-1 EKONOMI")
        self.assertEqual(status, "parsed")
        self.assertGreater(confidence, 0.95)
        self.assertEqual(issue, "")

    def test_combined_major_fragments_match_formation_options(self) -> None:
        value, status, _, issue = match_education(
            "D-III TEKNIK ELEKTRO / ELEKTRONIKA",
            "D-III KOMPUTER / D-III TEKNIK ELEKTRO / ELEKTRONIKA / D-III INFORMATIKA",
        )
        self.assertEqual(value, "D-III TEKNIK ELEKTRO / ELEKTRONIKA")
        self.assertEqual(status, "parsed")
        self.assertEqual(issue, "")

    def test_normalization_and_option_split(self) -> None:
        self.assertEqual(normalized("S-1 Teknik Sipil"), "S 1 TEKNIK SIPIL")
        self.assertEqual(
            split_education_options("S-1 TEKNIK SIPIL / D-IV TRANSPORTASI DARAT"),
            ["S-1 TEKNIK SIPIL", "D-IV TRANSPORTASI DARAT"],
        )


if __name__ == "__main__":
    unittest.main()
