from __future__ import annotations

import unittest

from parse_skd_panselnas import apply_canonical_institution_name


class LocalPanselnasParserTest(unittest.TestCase):
    def test_canonical_name_replaces_wrapped_pdf_header(self) -> None:
        clean = [{"nama_instansi": "Kementerian Pariwisata dan"}]
        formations = [{"nama_instansi": "Kementerian Pariwisata dan"}]

        apply_canonical_institution_name(
            [clean, formations],
            "Kementerian Pariwisata dan Ekonomi Kreatif",
        )

        self.assertEqual(
            clean[0]["nama_instansi"],
            "Kementerian Pariwisata dan Ekonomi Kreatif",
        )
        self.assertEqual(clean[0]["nama_instansi"], formations[0]["nama_instansi"])


if __name__ == "__main__":
    unittest.main()
