"""Aktienuebersicht – Verschluesselung der Datendateien (AES-256-GCM, Schluessel via PBKDF2-SHA256).

Format einer verschluesselten Datei (JSON):
  {"v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":310000,"salt":"<b64>","iv":"<b64>","ct":"<b64 Chiffrat||Tag>"}
Alle Dateien eines Standes verwenden dasselbe Salt (damit Web/Mac den abgeleiteten Schluessel einmal berechnen
und optional merken koennen); jede Verschluesselung erhaelt einen neuen zufaelligen IV (12 Byte).
Identisch implementiert in app.js (WebCrypto) und AktienuebersichtApp.swift (CryptoKit + CommonCrypto).
"""
import base64, hashlib, json, os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ITERATIONS = 310_000


class WrongPassword(Exception):
    pass


def b64e(b):
    return base64.b64encode(b).decode("ascii")


def b64d(s):
    return base64.b64decode(s)


def derive(password, salt, iterations=ITERATIONS):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)


class Keyring:
    """Leitet den Schluessel pro (Salt, Iterationen) nur einmal ab."""

    def __init__(self, password):
        self.password = password
        self.cache = {}
        self.salt = None  # Salt fuer neue Verschluesselungen

    def key(self, salt, iterations=ITERATIONS):
        k = (salt, iterations)
        if k not in self.cache:
            self.cache[k] = derive(self.password, salt, iterations)
        return self.cache[k]

    def decrypt(self, blob):
        salt = b64d(blob["salt"])
        it = int(blob.get("iter", ITERATIONS))
        try:
            pt = AESGCM(self.key(salt, it)).decrypt(b64d(blob["iv"]), b64d(blob["ct"]), None)
        except Exception as e:  # InvalidTag
            raise WrongPassword("Entschluesselung fehlgeschlagen (falsches Passwort?)") from e
        if self.salt is None:
            self.salt = salt
        return json.loads(pt.decode("utf-8"))

    def encrypt(self, obj):
        if self.salt is None:
            self.salt = os.urandom(16)
        iv = os.urandom(12)
        pt = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ct = AESGCM(self.key(self.salt)).encrypt(iv, pt, None)
        return {"v": 1, "alg": "AES-256-GCM", "kdf": "PBKDF2-SHA256", "iter": ITERATIONS,
                "salt": b64e(self.salt), "iv": b64e(iv), "ct": b64e(ct)}


def read_enc(path, ring):
    try:
        with open(path, encoding="utf-8") as f:
            blob = json.load(f)
    except FileNotFoundError:
        return None
    return ring.decrypt(blob)


def write_enc(path, obj, ring):
    """Schreibt nur, wenn sich der Inhalt geaendert hat (sonst entstuende wegen des neuen IV bei jedem Lauf ein Commit)."""
    try:
        if read_enc(path, ring) == json.loads(json.dumps(obj)):
            return False
    except (WrongPassword, ValueError):
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(ring.encrypt(obj), f, indent=1)
        f.write("\n")
    os.replace(tmp, path)
    return True
