#!/usr/bin/env python3
"""Hilfsprogramm fuer die verschluesselten Datendateien.

  AKTIEN_PASSWORD=… python3 scripts/passwort.py show data/quotes.enc.json   # entschluesselt anzeigen (nur lokal!)
  AKTIEN_PASSWORD=… AKTIEN_PASSWORD_NEU=… python3 scripts/passwort.py change  # alle Dateien mit neuem Passwort (neues Salt)
Passwoerter nur ueber Umgebungsvariablen uebergeben (nicht als Argument, damit sie nicht im Verlauf stehen).
"""
import glob, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aucrypt  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    old = aucrypt.Keyring(os.environ["AKTIEN_PASSWORD"])
    if sys.argv[1] == "show":
        print(json.dumps(aucrypt.read_enc(sys.argv[2], old), ensure_ascii=False, indent=1))
    elif sys.argv[1] == "change":
        new = aucrypt.Keyring(os.environ["AKTIEN_PASSWORD_NEU"])
        files = sorted(glob.glob(os.path.join(ROOT, "data", "*.enc.json")))
        data = {f: aucrypt.read_enc(f, old) for f in files}   # zuerst alles pruefen
        for f, obj in data.items():
            aucrypt.write_enc(f, obj, new)
            print("neu verschluesselt:", os.path.relpath(f, ROOT))
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
