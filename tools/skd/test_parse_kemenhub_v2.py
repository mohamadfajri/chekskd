from __future__ import annotations

import unittest
from pathlib import Path

from pypdf import PdfReader

from parse_kemenhub_v2 import (
    append_education,
    formation_identity_key,
    merge_recap_stats,
    page_kind,
    parse_education_block,
    parse_education_continuation,
    parse_formation,
    parse_recap_stats,
    parse_table_rows,
    validate_score_row,
)


PDF_PATH = Path("data/raw/pdfs/30-KEMENHUB.pdf")


class PageKindTest(unittest.TestCase):
    def test_announcement_title_is_not_a_result_page(self) -> None:
        text = "PENGUMUMAN HASIL SELEKSI KOMPETENSI DASAR CPNS 2024"
        self.assertEqual(page_kind(text), "unknown")

    def test_result_table_requires_participant_columns(self) -> None:
        text = "HASIL SELEKSI KOMPETENSI DASAR NO PESERTA NAMA TAHUN SKD"
        self.assertEqual(page_kind(text), "hasil")

    def test_formation_identity_ignores_wrapped_education_text(self) -> None:
        left = {
            "kode_instansi": "4051",
            "kode_jabatan": "JF0001001",
            "kode_lokasi": "40510040",
            "kode_jenis_formasi": "1",
            "pendidikan_formasi": "S-1 PENDIDIKAN FISIKA Pendidikan",
        }
        right = {**left, "pendidikan_formasi": "S-1 PENDIDIKAN FISIKA"}
        self.assertEqual(formation_identity_key(left), formation_identity_key(right))

    def test_recap_continuation_fills_missing_values(self) -> None:
        current = {"jumlah_peserta": None, "hadir": None}
        continuation = {"jumlah_peserta": 21, "hadir": 20}
        merged = merge_recap_stats(current, continuation)
        self.assertEqual(merged["jumlah_peserta"], 21)
        self.assertEqual(merged["hadir"], 20)

    def test_multi_page_education_continuation_is_cleaned(self) -> None:
        text = """
        PANITIA SELEKSI NASIONAL PENGADAAN CASN 2024
        DAN PERPUSTAKAAN/ (5110120) S-1 PENDIDIKAN MATEMATIKA/
        Pendidikan                (5110140) S-1 PENDIDIKAN KIMIA/                         1
        Kehadiran          Jumlah Peserta SKD
        """
        continuation = parse_education_continuation(text)
        self.assertEqual(
            continuation,
            "DAN PERPUSTAKAAN / S-1 PENDIDIKAN MATEMATIKA / S-1 PENDIDIKAN KIMIA /",
        )

    def test_multi_page_education_fragments_are_joined(self) -> None:
        self.assertEqual(
            append_education("S-1 ILMU INFORMASI", "DAN PERPUSTAKAAN / S-1 MATEMATIKA"),
            "S-1 ILMU INFORMASI DAN PERPUSTAKAAN / S-1 MATEMATIKA",
        )

    def test_education_text_crossing_count_column_is_not_truncated(self) -> None:
        lines = [
            "Kode                    Jumlah",
            "Jenis Formasi : 1 - UMUM 1",
            "D-III BAHASA INDONESIA/ (4408011) D-III BAHASA INGGRIS/",
            "Kehadiran",
        ]
        education, _ = parse_education_block(lines)
        self.assertEqual(
            education,
            "D-III BAHASA INDONESIA / D-III BAHASA INGGRIS /",
        )


@unittest.skipUnless(PDF_PATH.exists(), "Kemenhub PDF lokal belum tersedia")
class KemenhubParserIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.reader = PdfReader(str(PDF_PATH), strict=False)

    def layout_text(self, page_number: int) -> str:
        return self.reader.pages[page_number - 1].extract_text(extraction_mode="layout") or ""

    def test_page_2566_muliya(self) -> None:
        text = self.layout_text(2566)
        formation = parse_formation(text, 2566)
        rows = parse_table_rows(text, 2566)

        self.assertEqual(formation["kode_instansi"], "3009")
        self.assertEqual(formation["kode_jabatan"], "JP4291397")
        self.assertEqual(formation["kode_lokasi"], "30090201")
        self.assertEqual(formation["jenis_formasi"], "UMUM")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["nama"], "MULIYA DWI LIANTO PUTRI")
        self.assertEqual(rows[0]["pendidikan"], "D-III MANAJEMEN LOGISTIK")
        self.assertEqual(
            [rows[0][key] for key in ("twk", "tiu", "tkp", "total")],
            [65, 130, 169, 364],
        )
        self.assertEqual(validate_score_row(rows[0], formation), [])

    def test_wrapped_education_and_multiple_rows(self) -> None:
        text = self.layout_text(2568)
        formation = parse_formation(text, 2568)
        rows = parse_table_rows(text, 2568)

        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[2]["nama"], "WULAN AGUSTA DINI RAHAYU")
        self.assertEqual(rows[2]["pendidikan"], "D-III MANAJEMEN TRANSPORTASI PERAIRAN DARATAN")
        self.assertEqual(rows[2]["total"], 349)
        self.assertEqual(validate_score_row(rows[2], formation), [])

    def test_recap_page_2565(self) -> None:
        stats = parse_recap_stats(self.layout_text(2565))
        self.assertEqual(stats["jumlah_formasi"], 1)
        self.assertEqual(stats["jumlah_peserta"], 1)
        self.assertEqual(stats["hadir"], 1)
        self.assertEqual(stats["peserta_skd_2024"], 1)
        self.assertEqual(stats["nilai_tertinggi"], 364)

    def test_recap_with_null_values(self) -> None:
        stats = parse_recap_stats(self.layout_text(3))
        self.assertEqual(stats["jumlah_formasi"], 1)
        self.assertEqual(stats["jumlah_peserta"], 1)
        self.assertEqual(stats["lolos_pg"], 0)
        self.assertEqual(stats["nilai_tertinggi"], 315)
        self.assertIsNone(stats["nilai_lolos_pg_tertinggi"])

    def test_continuation_page_and_2023_score(self) -> None:
        first_page_rows = parse_table_rows(self.layout_text(68), 68)
        continuation_rows = parse_table_rows(self.layout_text(69), 69)

        self.assertEqual(len(first_page_rows), 17)
        self.assertEqual(len(continuation_rows), 10)
        self.assertEqual(first_page_rows[5]["tahun_nilai_skd"], 2023)
        self.assertEqual(first_page_rows[5]["nama"], "TAUFIK RAHMAT WIJAYA")
        self.assertEqual(continuation_rows[-1]["keterangan"], "TH")
        self.assertIsNone(continuation_rows[-1]["total"])

    def test_last_page_ignores_legend_text(self) -> None:
        rows = parse_table_rows(self.layout_text(2612), 2612)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[-1]["nama"], "SAUSAN FADILAH USMAN")
        self.assertEqual(rows[-1]["keterangan"], "TL")
        self.assertEqual(rows[-1]["total"], 271)


if __name__ == "__main__":
    unittest.main()
