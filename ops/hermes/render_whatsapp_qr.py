from pathlib import Path
import sys

import qrcode


def main() -> None:
    source_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    qr_value = source_path.read_text(encoding="utf-8").strip()

    if not qr_value:
        raise ValueError("WhatsApp pairing value is empty")

    qrcode.make(qr_value).save(output_path)


if __name__ == "__main__":
    main()
