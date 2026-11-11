from __future__ import annotations

import csv
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import pymupdf

from run_skd_intake import (
    HoldBatch, PdfCheck, inbox_pdfs, inspect_pdf, is_announcement_page, is_skb_syllabus,
    is_trailing_legend, run_queue, validate_recap_rows, validate_report,
)


class IntakeChecksTest(unittest.TestCase):
    def setUp(self) -> None:
        self.check = PdfCheck("4041", 30, frozenset(range(1, 10)))
        self.report = {
            "is_full_document": True,
            "pages_read": 30,
            "total_pages": 30,
            "institution_code_matches": True,
            "observed_institution_codes": ["4041"],
            "formations_total": 1,
            "unknown_pages": [1, 9],
            "page_parse_errors": [],
            "formations_needs_review": 0,
            "participants_needs_review": 0,
            "duplicate_participant_numbers": 0,
            "admin_import_rows": 2,
            "participants_total": 2,
            "formations_without_participants": 0,
        }

    def test_only_verified_preamble_can_be_ignored(self) -> None:
        validate_report(self.report, self.check)
        self.report["unknown_pages"].append(12)
        with self.assertRaises(HoldBatch):
            validate_report(self.report, self.check)

    def test_duplicate_or_incomplete_results_are_held(self) -> None:
        for field, value in (
            ("duplicate_participant_numbers", 1),
            ("pages_read", 29),
            ("participants_needs_review", 1),
            ("admin_import_rows", 1),
        ):
            with self.subTest(field=field), self.assertRaises(HoldBatch):
                validate_report({**self.report, field: value}, self.check)

    def test_legend_cannot_hide_participant_numbers(self) -> None:
        text = "KETERANGAN: - P/L : LOLOS - TL : TIDAK LOLOS - TH : TIDAK HADIR"
        self.assertTrue(is_trailing_legend(text))
        self.assertFalse(is_trailing_legend(text + " 24000000000000001"))
        check = PdfCheck("4041", 30, frozenset(range(1, 10)), frozenset({30}))
        validate_report({**self.report, "unknown_pages": [1, 30]}, check)

    def test_announcements_can_explain_scores_but_cannot_hide_a_score_table(self) -> None:
        self.assertTrue(is_announcement_page("PENJELASAN NILAI TWK TIU TKP"))
        self.assertFalse(is_announcement_page("NO PESERTA NAMA TWK TIU TKP"))
        self.assertFalse(is_announcement_page("TWK TIU TKP 24000000000000001"))

    def test_skb_syllabus_must_be_recognized_across_the_entire_appendix(self) -> None:
        title = "MATERI POKOK SOAL SELEKSI KOMPETENSI BIDANG"
        first = f"MENTERI PENDAYAGUNAAN APARATUR NEGARA DAN REFORMASI BIROKRASI HAL : {title}"
        table = "NO NAMA JABATAN MATERI POKOK"
        pages = [first, f"DAFTAR {title} {table}", table]
        self.assertTrue(is_skb_syllabus(pages))
        self.assertFalse(is_skb_syllabus([*pages, "DOKUMEN LAIN"]))
        self.assertFalse(is_skb_syllabus([*pages, f"{table} 24000000000000001"]))
        check = PdfCheck("3001", 30, frozenset(), ignored_appendix=frozenset({29, 30}))
        validate_report({
            **self.report, "unknown_pages": [29, 30], "observed_institution_codes": ["3001"],
        }, check)

    def test_missing_recap_count_does_not_pass_as_zero(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "formations.csv"
            row = {
                "kode_instansi": "4041", "validation_status": "valid",
                "jumlah_peserta": "2", "actual_peserta": "2",
                "jumlah_formasi": "1", "source_page_formasi": "10",
            }
            for expected in ("2", ""):
                with path.open("w", encoding="utf-8", newline="") as stream:
                    writer = csv.DictWriter(stream, fieldnames=list(row))
                    writer.writeheader()
                    writer.writerow({**row, "jumlah_peserta": expected})
                if expected:
                    validate_recap_rows(path, self.report, self.check)
                else:
                    with self.assertRaisesRegex(HoldBatch, "halaman 10"):
                        validate_recap_rows(path, self.report, self.check)


class IntakeQueueTest(unittest.TestCase):
    def test_recap_code_is_looked_up_in_catalog_not_in_menu(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for code in ("4023", "9999"):
                pdf = root / f"{code}.pdf"
                with pymupdf.open() as document:
                    page = document.new_page()
                    page.insert_text((32, 32), "PENGADAAN CPNS 2024")
                    page.insert_text((32, 54), "REKAPITULASI HASIL SELEKSI KOMPETENSI DASAR")
                    page.insert_text((32, 76), f"INSTANSI : {code} - CONTOH INSTANSI")
                    document.save(pdf)
                if code == "4023":
                    self.assertEqual(inspect_pdf(pdf).code, code)
                else:
                    with self.assertRaisesRegex(HoldBatch, "katalog SSCASN 2024"):
                        inspect_pdf(pdf)

    def test_inbox_reads_only_pdfs_at_top_level(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "z.PDF").touch()
            (root / "A.pdf").touch()
            (root / "note.txt").touch()
            (root / "archive").mkdir()
            (root / "archive/old.pdf").touch()
            self.assertEqual([path.name for path in inbox_pdfs(root)], ["A.pdf", "z.PDF"])

    def test_held_files_and_duplicate_institutions_do_not_stop_other_pdfs(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [root / name for name in (
                "2023.pdf", "duplicate-a.pdf", "duplicate-b.pdf", "bad-recap.pdf", "BPK.pdf",
            )]
            for pdf in paths:
                pdf.write_text(pdf.name, encoding="utf-8")
            checks = {
                "duplicate-a.pdf": PdfCheck("3004", 1, frozenset()),
                "duplicate-b.pdf": PdfCheck("3004", 1, frozenset()),
                "bad-recap.pdf": PdfCheck("4041", 1, frozenset()),
                "BPK.pdf": PdfCheck("4008", 1, frozenset()),
            }

            def inspect(pdf):
                if pdf.name not in checks:
                    raise HoldBatch("tahun 2023")
                return checks[pdf.name]

            def run(pdf, check, folder):
                if pdf.name == "bad-recap.pdf":
                    raise HoldBatch("rekap tidak cocok")
                result = folder / check.code / "bpk-2024-v3-staging.csv"
                result.parent.mkdir()
                result.write_text("staging", encoding="utf-8")
                return result

            with (
                patch("run_skd_intake.ROOT", root),
                patch("run_skd_intake.inspect_pdf", side_effect=inspect),
                patch("run_skd_intake.run_intake", side_effect=run) as runner,
                patch("builtins.print"),
            ):
                self.assertEqual(run_queue(paths, check_only=False, open_after=False), 1)
            self.assertEqual([call.args[0].name for call in runner.call_args_list], ["bad-recap.pdf", "BPK.pdf"])
            summary = next(root.rglob("RINGKASAN HASIL.txt")).read_text(encoding="utf-8")
            self.assertIn("CSV siap dicek: 1 | Ditahan: 4", summary)
            self.assertIn("[SIAP] BPK.pdf", summary)
            self.assertIn("rekap tidak cocok", summary)

            with (
                patch("run_skd_intake.ROOT", root),
                patch("run_skd_intake.inspect_pdf", side_effect=inspect),
                patch("run_skd_intake.run_intake", side_effect=run) as second,
                patch("builtins.print"),
            ):
                self.assertEqual(run_queue(paths, check_only=False, open_after=False), 1)
            self.assertEqual([call.args[0].name for call in second.call_args_list], ["bad-recap.pdf"])
            self.assertTrue(any("[SUDAH ADA] BPK.pdf" in path.read_text(encoding="utf-8")
                                for path in root.rglob("RINGKASAN HASIL.txt")))


if __name__ == "__main__":
    unittest.main()
