import base64
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile


MACH_O_MAGIC = {
    b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf',
    b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca',
}


def run(*args, check=True):
    result = subprocess.run(args, capture_output=True, text=True)
    if check and result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr.strip()}')
    return result


def sign_resources(resources, identity, keychain):
    if not resources.is_dir():
        raise RuntimeError(f'Missing resources directory: {resources}')
    signed = 0
    kept = 0
    for path in sorted(resources.rglob('*')):
        if not path.is_file() or path.is_symlink():
            continue
        with path.open('rb') as source:
            if source.read(4) not in MACH_O_MAGIC:
                continue
        binary = str(path)
        inspected = run('codesign', '-dv', '--verbose=4', binary, check=False)
        details = inspected.stdout + inspected.stderr
        if (inspected.returncode == 0
                and 'Authority=Developer ID Application:' in details
                and re.search(r'^Timestamp=(?!none|Not set).+', details, re.MULTILINE)
                and re.search(r'^CodeDirectory .*flags=0x[\da-f]+\([^)]*\bruntime\b', details, re.MULTILINE)
                and run('codesign', '--verify', '--strict', binary, check=False).returncode == 0):
            kept += 1
            continue
        entitlements = run('codesign', '-d', '--entitlements', ':-', binary, check=False)
        preserve = ['--preserve-metadata=entitlements'] if '<key>' in entitlements.stdout else []
        run('codesign', '--force', '--options', 'runtime', '--timestamp',
            '--keychain', keychain, '--sign', identity, *preserve, binary)
        run('codesign', '--verify', '--strict', binary)
        signed += 1
    print(f'Signed {signed} resource Mach-O binaries; preserved {kept} valid Developer ID signatures')


def main(resources=Path('src-tauri/resources')):
    for name in ('APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'RUNNER_TEMP'):
        if not os.environ.get(name):
            raise RuntimeError(f'Missing signing configuration: {name}')
    with tempfile.TemporaryDirectory(prefix='macos-resource-signing-', dir=os.environ['RUNNER_TEMP']) as temporary:
        root = Path(temporary)
        certificate = root / 'certificate.p12'
        certificate.write_bytes(base64.b64decode(''.join(os.environ['APPLE_CERTIFICATE'].split()), validate=True))
        keychain = str(root / 'signing.keychain-db')
        password = secrets.token_urlsafe(32)
        try:
            run('security', 'create-keychain', '-p', password, keychain)
            run('security', 'set-keychain-settings', '-lut', '3600', keychain)
            run('security', 'unlock-keychain', '-p', password, keychain)
            run('security', 'import', str(certificate), '-k', keychain,
                '-P', os.environ['APPLE_CERTIFICATE_PASSWORD'], '-T', '/usr/bin/codesign')
            run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain)
            identities = run('security', 'find-identity', '-v', '-p', 'codesigning', keychain).stdout
            matches = re.findall(r'^\s*\d+\)\s+([\dA-Fa-f]{40})\s+"Developer ID Application:[^"]+"', identities, re.MULTILINE)
            if len(matches) != 1:
                raise RuntimeError('Expected exactly one valid Developer ID Application certificate in APPLE_CERTIFICATE')
            sign_resources(resources, matches[0], keychain)
        finally:
            run('security', 'delete-keychain', keychain, check=False)


if __name__ == '__main__':
    main()
