import base64
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
NATIVE_FILES = [
    'node_modules/@univerjs-pro/engine-formula-rust-binding-darwin-arm64/univer-formula.darwin-arm64.node',
    'node_modules/@univerjs-pro/exchange-node-binding-darwin-arm64/univer-exchange-node.darwin-arm64.node',
    'node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib',
    'node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.5.node',
    'node_modules/@tencent-qqmail/agently-cli-darwin-arm64/bin/agently-cli',
]


def load_signer():
    spec = importlib.util.spec_from_file_location('macos_signing', Path(__file__).with_name('sign-macos-resources.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


class WorkflowTests(unittest.TestCase):
    def test_macos_workflows_sign_generated_resources_before_packaging_without_rebuilding(self):
        for filename in ('build-macos.yml', 'build-bundle-macos.yml'):
            with self.subTest(workflow=filename):
                source = (ROOT / '.github/workflows' / filename).read_text()
                build = re.search(r'run: (pnpm tauri build[^\n]*)', source)
                signing = source.find('python3 .github/scripts/sign-macos-resources.py')
                bundle = re.search(r'run: (pnpm tauri bundle[^\n]*)', source)
                self.assertIsNotNone(build)
                self.assertIn('--no-bundle', build[1], 'tauri build must finish regenerating resources before signing and notarization')
                self.assertGreater(signing, build.end(), 'native dependencies must be signed after beforeBuildCommand deploys them')
                self.assertIsNotNone(bundle)
                self.assertGreater(bundle.start(), signing)
                self.assertIn('--target ${{ matrix.target }}', bundle[1])
                self.assertIn('--bundles app,dmg', bundle[1])
                self.assertNotIn('pnpm tauri build', source[signing:])
                if filename == 'build-macos.yml':
                    self.assertIn('--config src-tauri/tauri.nightly.conf.json', bundle[1])


class ResourceSigningTests(unittest.TestCase):
    def setUp(self):
        self.helper = load_signer()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.resources = Path(self.temporary.name) / 'resources'
        self.resources.mkdir()
        self.calls = []
        self.details = {}
        self.entitlements = {}
        self.verify_exit = 0
        self.sign_exit = 0
        self.identities = '  1) ' + 'A' * 40 + ' "Developer ID Application: Fixture (TEAMID1234)"\n'
        self.original_run = self.helper.run
        self.runner = patch.object(self.helper, 'run', side_effect=self.command)
        self.runner.start()
        self.addCleanup(self.runner.stop)

    def native(self, name, magic=b'\xcf\xfa\xed\xfe'):
        target = self.resources / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(magic + bytes(28))
        return target

    def command(self, *args, check=True):
        self.calls.append(args)
        code = 0
        stdout = ''
        stderr = ''
        if args[:2] == ('security', 'find-identity'):
            stdout = self.identities
        elif args[:2] == ('codesign', '-dv'):
            stderr = self.details.get(Path(args[-1]).name, 'Signature=adhoc\n')
        elif args[:2] == ('codesign', '-d'):
            stdout = self.entitlements.get(Path(args[-1]).name, '')
        elif args[:2] == ('codesign', '--verify'):
            code = self.verify_exit
        elif args[:2] == ('codesign', '--force'):
            code = self.sign_exit
        if check and code:
            raise RuntimeError('fixture codesign failure')
        return subprocess.CompletedProcess(args, code, stdout, stderr)

    def signing_calls(self):
        return [call for call in self.calls if call[:2] == ('codesign', '--force')]

    def test_all_five_rejected_native_dependencies_receive_timestamped_hardened_signatures(self):
        expected = {self.native(name) for name in NATIVE_FILES}
        self.helper.sign_resources(self.resources, 'A' * 40, 'fixture-keychain')
        calls = self.signing_calls()
        self.assertEqual({Path(call[-1]) for call in calls}, expected)
        for call in calls:
            self.assertIn('--timestamp', call)
            self.assertEqual(call[call.index('--options') + 1], 'runtime')
            self.assertEqual(call[call.index('--sign') + 1], 'A' * 40)
            self.assertEqual(call[call.index('--keychain') + 1], 'fixture-keychain')
        self.assertEqual(len([call for call in self.calls if call[:2] == ('codesign', '--verify')]), 5)

    def test_mach_o_detection_includes_universal_and_extensionless_nonexecutable_files(self):
        expected = {self.native(f'file {index}', magic) for index, magic in enumerate((b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'))}
        (self.resources / 'script.node').write_text('module.exports = {}')
        self.helper.sign_resources(self.resources, 'fixture', 'keychain')
        self.assertEqual({Path(call[-1]) for call in self.signing_calls()}, expected)

    def test_preserves_valid_upstream_node_signature_and_jit_entitlements(self):
        self.native('node')
        self.details['node'] = 'Authority=Developer ID Application: Node.js Foundation\nTimestamp=Nov 19, 2026\nCodeDirectory v=20500 flags=0x10000(runtime)\n'
        self.helper.sign_resources(self.resources, 'fixture', 'keychain')
        self.assertEqual(self.signing_calls(), [])

    def test_repairs_incomplete_or_invalid_developer_id_signatures_without_losing_entitlements(self):
        self.native('node')
        self.entitlements['node'] = '<plist><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>'
        complete = 'Authority=Developer ID Application: Node.js Foundation\nTimestamp=Nov 19, 2026\nCodeDirectory v=20500 flags=0x10000(runtime)\n'
        for details, verify_exit in ((complete.replace('Timestamp=', 'Signed Time='), 0), (complete.replace('(runtime)', '(none)'), 0), (complete, 1)):
            with self.subTest(details=details, verify_exit=verify_exit):
                self.calls.clear()
                self.details['node'] = details
                self.verify_exit = verify_exit
                if verify_exit:
                    with self.assertRaisesRegex(RuntimeError, 'codesign failure'):
                        self.helper.sign_resources(self.resources, 'fixture', 'keychain')
                else:
                    self.helper.sign_resources(self.resources, 'fixture', 'keychain')
                self.assertEqual(len(self.signing_calls()), 1)
                self.assertIn('--preserve-metadata=entitlements', self.signing_calls()[0])

    def test_empty_resource_tree_needs_no_signatures(self):
        self.helper.sign_resources(self.resources, 'fixture', 'keychain')
        self.assertEqual(self.calls, [])

    def test_signing_failure_stops_before_packaging(self):
        self.native('failed.node')
        self.sign_exit = 1
        with self.assertRaisesRegex(RuntimeError, 'codesign failure'):
            self.helper.sign_resources(self.resources, 'fixture', 'keychain')

    def test_missing_resource_directory_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'resources'):
            self.helper.sign_resources(self.resources / 'missing', 'fixture', 'keychain')

    def test_temporary_certificate_and_keychain_are_cleaned_when_signing_fails(self):
        self.native('failed.node')
        self.sign_exit = 1
        with patch.dict(os.environ, {'RUNNER_TEMP': self.temporary.name, 'APPLE_CERTIFICATE': base64.b64encode(b'fixture').decode(), 'APPLE_CERTIFICATE_PASSWORD': 'fixture-password'}):
            with self.assertRaisesRegex(RuntimeError, 'codesign failure'):
                self.helper.main(self.resources)
        self.assertEqual([path.name for path in Path(self.temporary.name).iterdir()], ['resources'])
        self.assertEqual(len([call for call in self.calls if call[:2] == ('security', 'delete-keychain')]), 1)

    def test_non_developer_id_certificate_is_rejected_before_signing(self):
        self.identities = '  1) ' + 'A' * 40 + ' "Apple Development: Fixture"\n'
        with patch.dict(os.environ, {'RUNNER_TEMP': self.temporary.name, 'APPLE_CERTIFICATE': base64.b64encode(b'fixture').decode(), 'APPLE_CERTIFICATE_PASSWORD': 'fixture-password'}):
            with self.assertRaisesRegex(RuntimeError, 'Developer ID Application'):
                self.helper.main(self.resources)
        self.assertEqual(self.signing_calls(), [])

    def test_valid_certificate_signs_resources_and_removes_temporary_material(self):
        self.native('valid.node')
        with patch.dict(os.environ, {'RUNNER_TEMP': self.temporary.name, 'APPLE_CERTIFICATE': ' Zm\n l4dHVyZQ==\n', 'APPLE_CERTIFICATE_PASSWORD': 'fixture-password'}):
            self.helper.main(self.resources)
        self.assertEqual(len(self.signing_calls()), 1)
        self.assertEqual(self.signing_calls()[0][self.signing_calls()[0].index('--sign') + 1], 'A' * 40)
        self.assertEqual([path.name for path in Path(self.temporary.name).iterdir()], ['resources'])
        self.assertEqual(self.calls[-1][:2], ('security', 'delete-keychain'))

    def test_missing_credentials_are_rejected_before_keychain_access(self):
        with patch.dict(os.environ, {'APPLE_CERTIFICATE': '', 'APPLE_CERTIFICATE_PASSWORD': ''}):
            with self.assertRaisesRegex(RuntimeError, 'Missing signing configuration: APPLE_CERTIFICATE'):
                self.helper.main(self.resources)
        self.assertEqual(self.calls, [])

    def test_command_failure_does_not_print_certificate_password(self):
        failed = subprocess.CompletedProcess([], 1, '', 'PKCS12 import failed')
        with patch.object(self.helper.subprocess, 'run', return_value=failed):
            with self.assertRaisesRegex(RuntimeError, '^security failed: PKCS12 import failed$'):
                self.original_run('security', 'import', 'certificate.p12', '-P', 'fixture-password')


if __name__ == '__main__':
    unittest.main()
