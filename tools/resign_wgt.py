"""Re-sign a Tizen .wgt with author + distributor PKCS#12 certificates.

Usage: python3 -I resign_wgt.py <in.wgt> <out.wgt> <cert_dir> <work_dir>
cert_dir must contain author.p12, distributor.p12 and password.txt.
"""
import base64
import hashlib
import os
import re
import subprocess
import sys
import urllib.parse
import zipfile

DSIG_NS = "http://www.w3.org/2000/09/xmldsig#"
SIG_FILE_RE = re.compile(r"^(author-signature\.xml|signature\d+\.xml)$")


def b64(data):
    return base64.b64encode(data).decode()


def sha256_b64(data):
    return b64(hashlib.sha256(data).digest())


def openssl(*args, input_data=None):
    try:
        return subprocess.run(["openssl", *args], input=input_data, check=True, capture_output=True).stdout
    except subprocess.CalledProcessError:
        # Retry with -legacy flag for PKCS#12 legacy encryption compatibility in OpenSSL 3+
        if "pkcs12" in args and "-legacy" not in args:
            new_args = list(args)
            pkcs12_idx = new_args.index("pkcs12")
            new_args.insert(pkcs12_idx + 1, "-legacy")
            return subprocess.run(["openssl", *new_args], input=input_data, check=True, capture_output=True).stdout
        raise


def load_p12(path, password, work_dir, name):
    key_path = os.path.join(work_dir, f"{name}.key.pem")
    pw = f"pass:{password}"
    openssl("pkcs12", "-in", path, "-passin", pw, "-nocerts", "-nodes", "-out", key_path)
    certs_pem = openssl("pkcs12", "-in", path, "-passin", pw, "-nokeys").decode()
    certs = re.findall(r"-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----", certs_pem, re.S)
    certs = ["".join(c.split()) for c in certs]
    # Leaf first: the leaf certificate is the one whose subject is not an issuer of another cert.
    def subject_issuer(c):
        pem = f"-----BEGIN CERTIFICATE-----\n{c}\n-----END CERTIFICATE-----\n".encode()
        out = openssl("x509", "-noout", "-subject", "-issuer", "-nameopt", "RFC2253", input_data=pem).decode()
        subj = re.search(r"subject=(.*)", out).group(1)
        iss = re.search(r"issuer=(.*)", out).group(1)
        return subj, iss
    info = [subject_issuer(c) for c in certs]
    issuers = {iss for _, iss in info}
    ordered = sorted(zip(certs, info), key=lambda ci: ci[1][0] in issuers)
    return key_path, [c for c, _ in ordered]


def build_signature(sig_id, role, files, key_path, certs):
    refs = []
    for name, data in files:
        uri = urllib.parse.quote(name, safe="/")
        refs.append(
            f'<Reference URI="{uri}">\n'
            f'<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>\n'
            f"<DigestValue>{sha256_b64(data)}</DigestValue>\n"
            f"</Reference>\n"
        )
    obj_inner = (
        '<SignatureProperties xmlns:dsp="http://www.w3.org/2009/xmldsig-properties">'
        f'<SignatureProperty Id="profile" Target="#{sig_id}"><dsp:Profile URI="http://www.w3.org/ns/widgets-digsig#profile"></dsp:Profile></SignatureProperty>'
        f'<SignatureProperty Id="role" Target="#{sig_id}"><dsp:Role URI="http://www.w3.org/ns/widgets-digsig#role-{role}"></dsp:Role></SignatureProperty>'
        f'<SignatureProperty Id="identifier" Target="#{sig_id}"><dsp:Identifier></dsp:Identifier></SignatureProperty>'
        "</SignatureProperties>"
    )
    # Inclusive C14N 1.1 of the Object element: the in-scope default namespace is rendered on it.
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
    # Exclusive C14N of SignedInfo: the utilized default namespace is rendered on it.
    si_c14n = f'<SignedInfo xmlns="{DSIG_NS}">{si_body}</SignedInfo>'
    sig_value = b64(openssl("dgst", "-sha256", "-sign", key_path, input_data=si_c14n.encode()))
    x509 = "".join(f"<X509Certificate>\n{c}\n</X509Certificate>\n" for c in certs)
    return (
        f'<Signature xmlns="{DSIG_NS}" Id="{sig_id}">\n'
        f"<SignedInfo>{si_body}</SignedInfo>\n"
        f"<SignatureValue>\n{sig_value}\n</SignatureValue>\n"
        f"<KeyInfo>\n<X509Data>\n{x509}</X509Data>\n</KeyInfo>\n"
        f'<Object Id="prop">{obj_inner}</Object>\n'
        "</Signature>"
    ).encode()


def main():
    in_wgt, out_wgt, cert_dir, work_dir = sys.argv[1:5]
    with open(os.path.join(cert_dir, "password.txt")) as f:
        password = f.read().strip()
    author_key, author_certs = load_p12(os.path.join(cert_dir, "author.p12"), password, work_dir, "author")
    dist_key, dist_certs = load_p12(os.path.join(cert_dir, "distributor.p12"), password, work_dir, "distributor")

    with zipfile.ZipFile(in_wgt) as zin:
        files = [
            (i.filename, zin.read(i))
            for i in zin.infolist()
            if not i.is_dir() and not SIG_FILE_RE.match(i.filename)
        ]

    author_xml = build_signature("AuthorSignature", "author", files, author_key, author_certs)
    dist_files = files + [("author-signature.xml", author_xml)]
    dist_xml = build_signature("DistributorSignature", "distributor", dist_files, dist_key, dist_certs)

    with zipfile.ZipFile(out_wgt, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in files:
            zout.writestr(name, data)
        zout.writestr("author-signature.xml", author_xml)
        zout.writestr("signature1.xml", dist_xml)

    for p in (author_key, dist_key):
        os.remove(p)
    print(f"signed {len(files)} files -> {out_wgt}")


if __name__ == "__main__":
    main()
