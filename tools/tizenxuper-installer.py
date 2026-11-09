#!/usr/bin/env python3
"""
TizenXuper TV — Instalador 1-Click Multiplataforma (macOS · Windows · Linux · iOS a-Shell)
==========================================================================================
Uso rápido en Terminal (macOS / Linux / iOS a-Shell):
    curl -fsSL https://tizenxuper-tv.pages.dev/mac | python3

Uso con IP directa:
    TV_IP=192.168.1.5 python3 install.py
    python3 install.py --tv 192.168.1.5

Uso con interfaz gráfica (macOS / Windows):
    python3 install.py --gui
"""

import argparse
import base64
import concurrent.futures
import hashlib
import json
import os
import platform
import re
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

APP_NAME = "TizenXuper TV"
PACKAGE_ID = "XuperTVapp"
APP_ID = "XuperTVapp.XuperTV"
RELEASE_API_URL = "https://tizenxuper-tv.pages.dev/api/release"
GITHUB_LATEST_API = "https://api.github.com/repos/tizenxupertv/TizenXuperTV/releases/latest"
SDB_PORT = 26101

# SDB wire protocol constants
CMD_CNXN = 0x4E584E43
CMD_AUTH = 0x48545541
CMD_OPEN = 0x4E45504F
CMD_OKAY = 0x59414B4F
CMD_CLSE = 0x45534C43
CMD_WRTE = 0x45545257
SDB_VERSION = 0x01000000
SDB_MAXDATA = 262144

DSIG_NS = "http://www.w3.org/2000/09/xmldsig#"
SIG_FILE_RE = re.compile(r"^(author-signature\.xml|signature\d+\.xml)$")


def open_tty_input():
    """Returns an interactive input function that works even when piped via `curl ... | python3`."""
    tty_file = None
    if not sys.stdin.isatty():
        try:
            tty_path = "CONIN$" if os.name == "nt" else "/dev/tty"
            tty_file = open(tty_path, "r", encoding="utf-8", errors="replace")
        except Exception:
            tty_file = None

    def ask(prompt: str) -> str:
        sys.stdout.write(prompt)
        sys.stdout.flush()
        stream = tty_file if tty_file is not None else sys.stdin
        line = stream.readline()
        if not line:
            raise EOFError("No interactive terminal input available")
        return line.strip()

    return ask


def get_local_ip() -> str:
    """Detects the local LAN IPv4 address of this device."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(1.0)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except Exception:
        pass
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127."):
                return ip
    except Exception:
        pass
    return "192.168.1.X"


def probe_tv_host(ip: str, timeout: float = 0.35):
    """Checks if TCP port 26101 (Samsung SDB) is open on `ip` and fetches TV model metadata if available."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            if s.connect_ex((ip, SDB_PORT)) != 0:
                return None
    except Exception:
        return None

    name = "Samsung Smart TV"
    model = ""
    try:
        req = urllib.request.Request(
            f"http://{ip}:8001/api/v2/",
            headers={"User-Agent": "TizenXuperInstaller/1.0"}
        )
        with urllib.request.urlopen(req, timeout=0.8) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            dev = data.get("device") or {}
            name = dev.get("name") or data.get("name") or name
            model = dev.get("modelName") or dev.get("model") or ""
    except Exception:
        pass

    return {"ip": ip, "name": name, "model": model}


def scan_lan_for_tvs(local_ip: str, on_progress=None):
    """Scans the local /24 network for Samsung TVs with Developer Mode (port 26101) enabled."""
    parts = local_ip.split(".")
    if len(parts) != 4 or not all(p.isdigit() for p in parts):
        return []
    prefix = ".".join(parts[:3])
    candidates = [f"{prefix}.{i}" for i in range(1, 255) if f"{prefix}.{i}" != local_ip]
    found = []
    done = 0
    total = len(candidates)

    with concurrent.futures.ThreadPoolExecutor(max_workers=48) as pool:
        future_map = {pool.submit(probe_tv_host, ip): ip for ip in candidates}
        for fut in concurrent.futures.as_completed(future_map):
            done += 1
            if on_progress and done % 25 == 0:
                on_progress(done, total)
            res = fut.result()
            if res:
                found.append(res)

    found.sort(key=lambda d: [int(x) for x in d["ip"].split(".")])
    return found


class SdbClient:
    """Pure-Python client for Samsung Tizen SDB protocol over TCP port 26101 (zero external binaries)."""

    def __init__(self, host: str, port: int = SDB_PORT, timeout: float = 15.0):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.sock = None
        self.max_payload = SDB_MAXDATA
        self._next_local_id = 1

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        self.sock.settimeout(self.timeout)
        self._send_frame(CMD_CNXN, SDB_VERSION, SDB_MAXDATA, b"host::\x00")
        while True:
            cmd, arg0, arg1, payload = self._read_frame()
            if cmd == CMD_CNXN:
                if arg1 > 0:
                    self.max_payload = min(SDB_MAXDATA, arg1)
                return
            if cmd == CMD_AUTH:
                # Type 1 = TOKEN; reply with AUTH Type 3 (RSAPUBLICKEY) + dummy key so TV accepts connection
                if arg0 == 1:
                    self._send_frame(CMD_AUTH, 3, 0, b"tizenxuper-installer-key\x00")
                else:
                    raise RuntimeError("La TV solicitó autenticación SDB desconocida.")
            else:
                raise RuntimeError(f"Respuesta SDB inesperada al conectar: 0x{cmd:08x}")

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None

    def _send_frame(self, cmd: int, arg0: int, arg1: int, payload: bytes = b""):
        checksum = sum(payload) & 0xFFFFFFFF
        magic = cmd ^ 0xFFFFFFFF
        header = struct.pack("<6I", cmd, arg0, arg1, len(payload), checksum, magic)
        self.sock.sendall(header + payload)

    def _read_exact(self, n: int) -> bytes:
        buf = bytearray()
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise EOFError("La TV cerró la conexión SDB inesperadamente.")
            buf.extend(chunk)
        return bytes(buf)

    def _read_frame(self):
        raw_hdr = self._read_exact(24)
        cmd, arg0, arg1, data_len, checksum, magic = struct.unpack("<6I", raw_hdr)
        if data_len > 4 * 1024 * 1024:
            raise RuntimeError(f"Frame SDB excede el tamaño máximo ({data_len} bytes)")
        payload = self._read_exact(data_len) if data_len > 0 else b""
        return cmd, arg0, arg1, payload

    def run_shell(self, command: str, timeout: float = 30.0) -> str:
        """Opens a `shell:` stream on the TV, reads output until CLSE, and returns UTF-8 text."""
        self.sock.settimeout(timeout)
        local_id = self._next_local_id
        self._next_local_id += 1
        dest = f"shell:{command}\x00".encode("utf-8")
        self._send_frame(CMD_OPEN, local_id, 0, dest)

        remote_id = None
        output = bytearray()
        while True:
            cmd, arg0, arg1, payload = self._read_frame()
            if cmd == CMD_OKAY and arg1 == local_id:
                remote_id = arg0
            elif cmd == CMD_WRTE and arg1 == local_id:
                remote_id = arg0
                output.extend(payload)
                self._send_frame(CMD_OKAY, local_id, remote_id, b"")
            elif cmd == CMD_CLSE and (arg1 == local_id or arg0 == remote_id):
                if remote_id is not None:
                    self._send_frame(CMD_CLSE, local_id, remote_id, b"")
                break
        return output.decode("utf-8", errors="replace")

    def push_file(self, local_path: str, remote_path: str, on_progress=None):
        """Uploads a local file to `remote_path` on the TV using the SDB `sync:` protocol."""
        self.sock.settimeout(60.0)
        local_id = self._next_local_id
        self._next_local_id += 1
        self._send_frame(CMD_OPEN, local_id, 0, b"sync:\x00")

        remote_id = None
        while True:
            cmd, arg0, arg1, _ = self._read_frame()
            if cmd == CMD_OKAY and arg1 == local_id:
                remote_id = arg0
                break
            if cmd == CMD_CLSE and arg1 == local_id:
                raise RuntimeError("La TV rechazó abrir el canal de transferencia sync:")

        def write_sync_stream(data: bytes):
            # Split into SDB WRTE frames (<= 32 KB per frame for broad Tizen compatibility)
            step = min(32768, self.max_payload)
            offset = 0
            while offset < len(data):
                piece = data[offset:offset + step]
                self._send_frame(CMD_WRTE, local_id, remote_id, piece)
                while True:
                    c, a0, a1, pl = self._read_frame()
                    if c == CMD_OKAY and a1 == local_id:
                        break
                    if c == CMD_WRTE and a1 == local_id:
                        self._send_frame(CMD_OKAY, local_id, a0, b"")
                        if pl.startswith(b"FAIL"):
                            msg = pl[8:].decode("utf-8", errors="replace")
                            raise RuntimeError(f"Error SDB sync: {msg}")
                    if c == CMD_CLSE and a1 == local_id:
                        raise RuntimeError("Canal SDB sync cerrado durante el envío.")
                offset += len(piece)

        path_spec = f"{remote_path},33261".encode("utf-8")  # 0100755 octal
        send_Packet = bytearray(b"SEND") + struct.pack("<I", len(path_spec)) + path_spec

        file_size = os.path.getsize(local_path)
        sent = 0
        sync_buf = bytearray(send_Packet)

        with open(local_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                sync_buf.extend(b"DATA")
                sync_buf.extend(struct.pack("<I", len(chunk)))
                sync_buf.extend(chunk)
                if len(sync_buf) >= 65536:
                    write_sync_stream(bytes(sync_buf))
                    sync_buf.clear()
                sent += len(chunk)
                if on_progress:
                    on_progress(sent, file_size)

        mtime = int(time.time())
        sync_buf.extend(b"DONE")
        sync_buf.extend(struct.pack("<I", mtime))
        write_sync_stream(bytes(sync_buf))

        # Expect OKAY from sync service
        while True:
            cmd, arg0, arg1, payload = self._read_frame()
            if cmd == CMD_WRTE and arg1 == local_id:
                self._send_frame(CMD_OKAY, local_id, arg0, b"")
                if payload.startswith(b"OKAY"):
                    break
                if payload.startswith(b"FAIL"):
                    msg = payload[8:].decode("utf-8", errors="replace")
                    raise RuntimeError(f"La TV rechazó guardar el archivo ({remote_path}): {msg}")
            elif cmd == CMD_CLSE and arg1 == local_id:
                break

        self._send_frame(CMD_CLSE, local_id, remote_id, b"")
        while True:
            cmd, _, arg1, _ = self._read_frame()
            if cmd == CMD_CLSE and arg1 == local_id:
                break

    def get_tv_info(self):
        duid_raw = self.run_shell("0 getduid", timeout=10.0).strip()
        cap_raw = self.run_shell("0 capability", timeout=10.0)
        sdk_toolpath = "/home/owner/share/tmp/sdk_tools"
        platform_ver = ""
        for line in cap_raw.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                k = k.strip()
                v = v.strip()
                if k == "sdk_toolpath" and v:
                    sdk_toolpath = v
                elif k == "platform_version" and v:
                    platform_ver = v
        return {
            "duid": duid_raw,
            "sdk_toolpath": sdk_toolpath,
            "platform_version": platform_ver
        }


def find_existing_certificate_dirs():
    """Finds any existing Apps2Samsung or Tizen Studio certificate directories on this computer."""
    home = os.path.expanduser("~")
    candidates = [
        os.path.join(home, "Library", "Application Support", "Apps2Samsung", "Certificate", "Jelly2Sams - Partner"),
        os.path.join(home, "Library", "Application Support", "Apps2Samsung", "Certificate", "Jelly2Sams"),
        os.path.join(home, "SamsungCertificate", "TizenXuper"),
        os.path.join(home, ".tizenxuper", "certs"),
    ]
    appdata = os.environ.get("APPDATA") or ""
    localappdata = os.environ.get("LOCALAPPDATA") or ""
    for base in (appdata, localappdata):
        if base:
            candidates.append(os.path.join(base, "Apps2Samsung", "Certificate", "Jelly2Sams - Partner"))
            candidates.append(os.path.join(base, "Apps2Samsung", "Certificate", "Jelly2Sams"))
            candidates.append(os.path.join(base, "CactusTV", "Certificates"))

    # Also scan parent folders if they exist
    for parent in [
        os.path.join(home, "Library", "Application Support", "Apps2Samsung", "Certificate"),
        os.path.join(appdata, "Apps2Samsung", "Certificate") if appdata else "",
        os.path.join(home, "SamsungCertificate"),
    ]:
        if parent and os.path.isdir(parent):
            try:
                for sub in os.listdir(parent):
                    p = os.path.join(parent, sub)
                    if os.path.isdir(p) and p not in candidates:
                        candidates.append(p)
            except Exception:
                pass

    valid = []
    for c in candidates:
        if (
            c
            and os.path.isdir(c)
            and os.path.isfile(os.path.join(c, "author.p12"))
            and os.path.isfile(os.path.join(c, "distributor.p12"))
        ):
            valid.append(c)
    return valid


def resign_wgt_with_cert_dir(in_wgt: str, out_wgt: str, cert_dir: str) -> bool:
    """Re-signs `in_wgt` using `author.p12` and `distributor.p12` in `cert_dir` via openssl."""
    pw_file = os.path.join(cert_dir, "password.txt")
    if not os.path.isfile(pw_file):
        return False
    try:
        with open(pw_file, "r", encoding="utf-8") as f:
            password = f.read().strip()

        work_dir = tempfile.mkdtemp(prefix="xuper_sign_")

        def run_openssl(*args, input_data=None):
            return subprocess.run(
                ["openssl", *args],
                input=input_data,
                check=True,
                capture_output=True
            ).stdout

        def load_p12(p12_path, name):
            key_path = os.path.join(work_dir, f"{name}.key.pem")
            pw_arg = f"pass:{password}"
            run_openssl("pkcs12", "-in", p12_path, "-passin", pw_arg, "-nocerts", "-nodes", "-out", key_path)
            certs_pem = run_openssl("pkcs12", "-in", p12_path, "-passin", pw_arg, "-nokeys").decode()
            certs = re.findall(r"-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----", certs_pem, re.S)
            certs = ["".join(c.split()) for c in certs]

            def subj_iss(c):
                pem = f"-----BEGIN CERTIFICATE-----\n{c}\n-----END CERTIFICATE-----\n".encode()
                out = run_openssl("x509", "-noout", "-subject", "-issuer", "-nameopt", "RFC2253", input_data=pem).decode()
                s = re.search(r"subject=(.*)", out).group(1)
                i = re.search(r"issuer=(.*)", out).group(1)
                return s, i

            info = [subj_iss(c) for c in certs]
            issuers = {i for _, i in info}
            ordered = sorted(zip(certs, info), key=lambda ci: ci[1][0] in issuers)
            return key_path, [c for c, _ in ordered]

        def b64(data: bytes) -> str:
            return base64.b64encode(data).decode()

        def sha256_b64(data: bytes) -> str:
            return b64(hashlib.sha256(data).digest())

        def build_sig(sig_id, role, files, key_path, certs):
            refs = []
            for fname, fdata in files:
                uri = urllib.parse.quote(fname, safe="/")
                refs.append(
                    f'<Reference URI="{uri}">\n'
                    f'<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>\n'
                    f"<DigestValue>{sha256_b64(fdata)}</DigestValue>\n"
                    f"</Reference>\n"
                )
            obj_inner = (
                '<SignatureProperties xmlns:dsp="http://www.w3.org/2009/xmldsig-properties">'
                f'<SignatureProperty Id="profile" Target="#{sig_id}"><dsp:Profile URI="http://www.w3.org/ns/widgets-digsig#profile"></dsp:Profile></SignatureProperty>'
                f'<SignatureProperty Id="role" Target="#{sig_id}"><dsp:Role URI="http://www.w3.org/ns/widgets-digsig#role-{role}"></dsp:Role></SignatureProperty>'
                f'<SignatureProperty Id="identifier" Target="#{sig_id}"><dsp:Identifier></dsp:Identifier></SignatureProperty>'
                "</SignatureProperties>"
            )
            obj_c14n = f'<Object xmlns="{DSIG_NS}" Id="prop">{obj_inner}</Object>'
            refs.append(
                '<Reference URI="#prop">\n'
                '<Transforms>\n<Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></Transform>\n</Transforms>\n'
                '<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>\n'
                f"<DigestValue>{sha256_b64(obj_c14n.encode())}</DigestValue>\n"
                "</Reference>\n"
            )
            si_body = (
                "\n"
                '<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod>\n'
                '<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>\n'
                + "".join(refs)
            )
            si_c14n = f'<SignedInfo xmlns="{DSIG_NS}">{si_body}</SignedInfo>'
            sig_val = b64(run_openssl("dgst", "-sha256", "-sign", key_path, input_data=si_c14n.encode()))
            x509 = "".join(f"<X509Certificate>\n{c}\n</X509Certificate>\n" for c in certs)
            return (
                f'<Signature xmlns="{DSIG_NS}" Id="{sig_id}">\n'
                f"<SignedInfo>{si_body}</SignedInfo>\n"
                f"<SignatureValue>\n{sig_val}\n</SignatureValue>\n"
                f"<KeyInfo>\n<X509Data>\n{x509}</X509Data>\n</KeyInfo>\n"
                f'<Object Id="prop">{obj_inner}</Object>\n'
                "</Signature>"
            ).encode()

        author_key, author_certs = load_p12(os.path.join(cert_dir, "author.p12"), "author")
        dist_key, dist_certs = load_p12(os.path.join(cert_dir, "distributor.p12"), "distributor")

        with zipfile.ZipFile(in_wgt) as zin:
            files = [
                (i.filename, zin.read(i))
                for i in zin.infolist()
                if not i.is_dir() and not SIG_FILE_RE.match(i.filename)
            ]

        author_xml = build_sig("AuthorSignature", "author", files, author_key, author_certs)
        dist_files = files + [("author-signature.xml", author_xml)]
        dist_xml = build_sig("DistributorSignature", "distributor", dist_files, dist_key, dist_certs)

        with zipfile.ZipFile(out_wgt, "w", zipfile.ZIP_DEFLATED) as zout:
            for fname, fdata in files:
                zout.writestr(fname, fdata)
            zout.writestr("author-signature.xml", author_xml)
            zout.writestr("signature1.xml", dist_xml)

        for p in (author_key, dist_key):
            try:
                os.remove(p)
            except Exception:
                pass
        return True
    except Exception:
        return False


def fetch_latest_release():
    """Fetches the latest release metadata from TizenXuper Pages API or GitHub API."""
    for url in (RELEASE_API_URL, GITHUB_LATEST_API):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "TizenXuperInstaller/1.0"})
            with urllib.request.urlopen(req, timeout=10.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if "wgtUrl" in data and data["wgtUrl"]:
                    return {
                        "version": data.get("version") or data.get("tag", "").lstrip("v"),
                        "wgtName": data.get("wgtName") or "TizenXuperTV.wgt",
                        "wgtUrl": data["wgtUrl"]
                    }
                if "assets" in data:
                    tag = data.get("tag_name", "")
                    wgts = [a for a in data.get("assets", []) if a.get("name", "").lower().endswith(".wgt")]
                    wgt = next((a for a in wgts if any(ch.isdigit() for ch in a["name"])), wgts[0] if wgts else None)
                    if wgt:
                        return {
                            "version": tag.lstrip("v"),
                            "wgtName": wgt["name"],
                            "wgtUrl": wgt["browser_download_url"]
                        }
        except Exception:
            continue
    raise RuntimeError("No se pudo obtener la información de la última versión desde Internet.")


def download_file(url: str, dest_path: str, on_progress=None):
    req = urllib.request.Request(url, headers={"User-Agent": "TizenXuperInstaller/1.0"})
    with urllib.request.urlopen(req, timeout=60.0) as resp, open(dest_path, "wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        read_bytes = 0
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            out.write(chunk)
            read_bytes += len(chunk)
            if on_progress and total > 0:
                on_progress(read_bytes, total)


def install_wgt_to_tv(tv_ip: str, wgt_path: str, log_fn=print):
    """Connects to the Samsung TV at `tv_ip`, uploads the `.wgt`, runs `vd_appinstall`, and launches the app."""
    log_fn(f"🔗 Conectando con tu Samsung TV en {tv_ip}:{SDB_PORT}...")
    client = SdbClient(tv_ip, SDB_PORT)
    try:
        client.connect()
        info = client.get_tv_info()
        duid = info["duid"]
        sdk_toolpath = info["sdk_toolpath"]
        plat = info["platform_version"]
        log_fn(f"✓ TV conectada · Tizen {plat or 'detectado'} · DUID: {duid[:18]}...")

        # Check if we have a local certificate directory we can use to re-sign or push device-profile.xml
        cert_dirs = find_existing_certificate_dirs()
        upload_wgt = wgt_path
        tmp_signed = None
        if cert_dirs:
            cert_dir = cert_dirs[0]
            dev_profile = os.path.join(cert_dir, "device-profile.xml")
            if os.path.isfile(dev_profile):
                try:
                    client.push_file(dev_profile, f"{sdk_toolpath}/device-profile.xml")
                except Exception:
                    pass
            tmp_signed = os.path.join(tempfile.gettempdir(), "TizenXuperTV_custom_signed.wgt")
            if resign_wgt_with_cert_dir(wgt_path, tmp_signed, cert_dir):
                log_fn("🔐 Paquete firmado con el certificado Samsung guardado en este equipo.")
                upload_wgt = tmp_signed

        remote_wgt = f"{sdk_toolpath}/tmp/TizenXuperTV.wgt"
        log_fn("📤 Enviando TizenXuper TV al televisor...")
        client.push_file(upload_wgt, remote_wgt)

        if tmp_signed and os.path.isfile(tmp_signed):
            try:
                os.remove(tmp_signed)
            except Exception:
                pass

        log_fn("⚙️  Instalando en tu Samsung TV (esto toma unos 8 segundos)...")
        install_out = client.run_shell(f"0 vd_appinstall {PACKAGE_ID} {remote_wgt}", timeout=60.0)
        try:
            client.run_shell(f"0 rmfile {remote_wgt}", timeout=5.0)
        except Exception:
            pass

        if "install completed" in install_out.lower() or "val[ok]" in install_out.lower():
            log_fn("🚀 Abriendo TizenXuper TV en tu televisor...")
            try:
                client.run_shell(f"0 was_execute {APP_ID}", timeout=10.0)
            except Exception:
                pass
            log_fn("\n✅ ¡LISTO! TizenXuper TV ya está instalada y abierta en tu Samsung TV.")
            log_fn("   A partir de ahora la app se actualiza sola desde la TV.")
            return True

        # Check if failure is due to missing Samsung device-profile certificate on a new TV
        if "118012" in install_out or "-12" in install_out or "certificate" in install_out.lower() or "signature" in install_out.lower():
            raise RuntimeError(
                "Tu televisor requiere autorizar el certificado Samsung por primera vez (código 118012).\n"
                f"   El paquete descargado está listo en: {wgt_path}\n"
                "   Ábrelo una sola vez con Apps2Samsung (https://apps2samsung.com) para registrar el certificado de tu TV."
            )

        raise RuntimeError(f"La TV devolvió un error al instalar:\n{install_out.strip()}")
    finally:
        client.close()


def run_cli(args):
    ask = open_tty_input()
    local_ip = get_local_ip()

    print("\n============================================================")
    print("  📺  INSTALADOR 1-CLICK DE TIZENXUPER TV PARA SAMSUNG TV")
    print("============================================================")
    print(f"  Sistema detectado : {platform.system()} ({platform.machine()})")
    print(f"  IP de este equipo : {local_ip}")
    print("------------------------------------------------------------\n")

    tv_ip = args.tv or os.environ.get("TV_IP", "").strip()
    if not tv_ip:
        print("🔍 Buscando televisores Samsung con Developer Mode en tu red Wi-Fi...")
        tvs = scan_lan_for_tvs(local_ip)
        if len(tvs) == 1:
            t = tvs[0]
            label = f"{t['name']} ({t['model']})" if t["model"] else t["name"]
            print(f"✓ Televisor encontrado automáticamente: {label} en {t['ip']}")
            ans = ask(f"¿Instalar en {t['ip']}? [S/n]: ").lower()
            if ans in ("", "s", "si", "sí", "y", "yes"):
                tv_ip = t["ip"]
        elif len(tvs) > 1:
            print("✓ Se encontraron varios televisores Samsung en tu red:")
            for idx, t in enumerate(tvs, 1):
                label = f"{t['name']} ({t['model']})" if t["model"] else t["name"]
                print(f"  [{idx}] {t['ip']} — {label}")
            choice = ask("Elige el número de tu TV (o escribe la IP): ")
            if choice.isdigit() and 1 <= int(choice) <= len(tvs):
                tv_ip = tvs[int(choice) - 1]["ip"]
            else:
                tv_ip = choice
        else:
            print("⚠️  No se detectó ninguna TV con el puerto 26101 abierto todavía.")
            print("\n   Verifica en tu TV Samsung:")
            print("   1. Abre 'Apps' y marca con el control remoto: 1 2 3 4 5")
            print("   2. Activa 'Developer mode' en ON")
            print(f"   3. Escribe esta IP en 'Host PC IP': {local_ip}")
            print("   4. Mantén pulsado el botón de apagar del control hasta que la TV reinicie.\n")
            tv_ip = ask("Escribe la IP de tu TV Samsung (ej. 192.168.1.5): ")

    if not tv_ip:
        print("Operación cancelada.")
        sys.exit(1)

    wgt_path = args.wgt
    if not wgt_path:
        print("\n⬇️  Consultando la última versión de TizenXuper TV...")
        rel = fetch_latest_release()
        print(f"✓ Última versión disponible: v{rel['version']} ({rel['wgtName']})")
        wgt_path = os.path.join(tempfile.gettempdir(), rel["wgtName"])
        print("⬇️  Descargando paquete .wgt...")
        download_file(rel["wgtUrl"], wgt_path)
        print(f"✓ Descargado en: {wgt_path}\n")

    try:
        install_wgt_to_tv(tv_ip, wgt_path)
    except Exception as e:
        print(f"\n❌ {e}\n")
        sys.exit(1)


def run_gui():
    import tkinter as tk
    from tkinter import ttk, messagebox
    import threading

    local_ip = get_local_ip()
    root = tk.Tk()
    root.title("Instalar TizenXuper TV — Samsung Smart TV")
    root.geometry("560x440")
    root.configure(bg="#0b0f19")
    root.resizable(False, False)

    title_lbl = tk.Label(
        root,
        text="TIZENXUPER TV · INSTALADOR 1-CLICK",
        font=("Helvetica", 15, "bold"),
        fg="#00e5ff",
        bg="#0b0f19"
    )
    title_lbl.pack(pady=(20, 4))

    sub_lbl = tk.Label(
        root,
        text=f"IP de este equipo (para Developer Mode en tu TV): {local_ip}",
        font=("Helvetica", 11),
        fg="#94a3b8",
        bg="#0b0f19"
    )
    sub_lbl.pack(pady=(0, 14))

    frame = tk.Frame(root, bg="#131b2e", padx=18, pady=16)
    frame.pack(fill="x", padx=24)

    tk.Label(frame, text="IP de tu TV Samsung:", font=("Helvetica", 11, "bold"), fg="#f8fafc", bg="#131b2e").grid(row=0, column=0, sticky="w")
    ip_var = tk.StringVar()
    ip_entry = tk.Entry(frame, textvariable=ip_var, width=22, font=("Helvetica", 12), bg="#0b0f19", fg="#ffffff", insertbackground="#ffffff")
    ip_entry.grid(row=0, column=1, padx=10)

    log_box = tk.Text(root, height=11, bg="#070a12", fg="#e2e8f0", font=("Menlo", 10), relief="flat", padx=12, pady=10)
    log_box.pack(fill="both", expand=True, padx=24, pady=14)

    def log(msg: str):
        def _append():
            log_box.insert("end", msg + "\n")
            log_box.see("end")
        root.after(0, _append)

    def do_scan():
        log("🔍 Buscando televisores Samsung en tu red Wi-Fi...")
        def _worker():
            tvs = scan_lan_for_tvs(local_ip)
            if tvs:
                ip_var.set(tvs[0]["ip"])
                for t in tvs:
                    log(f"✓ Encontrada: {t['ip']} — {t['name']} {t['model']}")
            else:
                log("⚠️ No se detectó una TV con puerto 26101 abierto. Escribe su IP arriba.")
        threading.Thread(target=_worker, daemon=True).start()

    def do_install():
        target_ip = ip_var.get().strip()
        if not target_ip:
            messagebox.showwarning("IP requerida", "Escribe la IP de tu TV Samsung o pulsa 'Buscar mi TV'.")
            return
        def _worker():
            try:
                log("⬇️ Descargando la última versión de TizenXuper TV...")
                rel = fetch_latest_release()
                wgt_path = os.path.join(tempfile.gettempdir(), rel["wgtName"])
                download_file(rel["wgtUrl"], wgt_path)
                log(f"✓ Versión v{rel['version']} descargada.")
                install_wgt_to_tv(target_ip, wgt_path, log_fn=log)
            except Exception as exc:
                log(f"❌ {exc}")
        threading.Thread(target=_worker, daemon=True).start()

    btn_scan = tk.Button(frame, text="Buscar mi TV", command=do_scan, bg="#1e293b", fg="#00e5ff", font=("Helvetica", 10, "bold"), padx=10, pady=4)
    btn_scan.grid(row=0, column=2, padx=4)

    btn_install = tk.Button(
        root,
        text="Instalar y Abrir en mi Samsung TV",
        command=do_install,
        bg="#00e5ff",
        fg="#000000",
        font=("Helvetica", 12, "bold"),
        padx=18,
        pady=8
    )
    btn_install.pack(pady=(0, 18))

    do_scan()
    root.mainloop()


def main():
    parser = argparse.ArgumentParser(description="Instalador 1-Click de TizenXuper TV para Samsung Smart TV")
    parser.add_argument("--tv", help="Dirección IP de la TV Samsung (ej. 192.168.1.5)")
    parser.add_argument("--wgt", help="Ruta a un archivo .wgt local opcional")
    parser.add_argument("--gui", action="store_true", help="Abrir ventana gráfica (Tkinter)")
    args = parser.parse_args()

    if args.gui:
        run_gui()
    else:
        run_cli(args)


if __name__ == "__main__":
    main()
