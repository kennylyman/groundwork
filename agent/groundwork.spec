# groundwork.spec
# Cross-platform PyInstaller spec for the Groundwork agent.
#
# Branches on sys.platform so the same .spec file builds the right
# binary on windows-latest and macos-latest CI runners. The Windows
# branch produces Groundwork.exe; the Mac branch produces a single-
# file Groundwork executable (no extension), renamed in build.yml to
# Groundwork-mac before upload so the two artifacts don't collide on
# the GitHub Releases page.

import sys

block_cipher = None
IS_WINDOWS = sys.platform == 'win32'
IS_MAC = sys.platform == 'darwin'

# Platform-specific hidden imports. Windows pulls in winreg + pynput's
# win32 backends; Mac pulls in pynput's darwin backends + pyobjc bridge
# modules needed for active-window detection via osascript.
windows_hidden = [
    'pynput.keyboard._win32',
    'pynput.mouse._win32',
    'win32gui',
    'win32process',
    'win32con',
]
mac_hidden = [
    'pynput.keyboard._darwin',
    'pynput.mouse._darwin',
    # mss has a darwin backend; explicit hiddenimport so PyInstaller
    # bundles it on Mac builds.
    'mss.darwin',
]

# Platform-specific excludes. On Mac we still exclude heavyweight Python
# scientific stack to keep the binary small. On Windows we additionally
# exclude pyobjc to avoid bundling Mac-only frameworks.
common_excludes = ['matplotlib', 'numpy', 'pandas', 'scipy']
windows_excludes = common_excludes + [
    'pyobjc',
    'pyobjc-core',
    'pyobjc-framework-Quartz',
    'pyobjc-framework-Cocoa',
]
mac_excludes = common_excludes + [
    # On Mac the windows-only deps wouldn't be installed anyway, but
    # listing them stops PyInstaller from emitting warnings about
    # missing modules.
    'pywin32',
    'pywinauto',
    'win32gui',
    'win32process',
    'win32con',
    'winreg',
]

base_hidden = [
    'anthropic',
    'mss',
    'PIL',
    'PIL.Image',
    'pynput',
    'pynput.keyboard',
    'pynput.mouse',
    'cryptography',
    'requests',
    'dotenv',
    'psutil',
    'tkinter',
    'tkinter.ttk',
]
if IS_WINDOWS:
    base_hidden.append('mss.windows')
    hiddenimports = base_hidden + windows_hidden
    excludes = windows_excludes
elif IS_MAC:
    hiddenimports = base_hidden + mac_hidden
    excludes = mac_excludes
else:
    hiddenimports = base_hidden
    excludes = common_excludes

a = Analysis(
    ['src/main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('src/.env', '.'),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(
    a.pure,
    a.zipped_data,
    cipher=block_cipher
)

# runtime_tmpdir: env-var expansion happens in the PyInstaller bootloader
# at runtime, so we use the platform-appropriate path. Windows expands
# %APPDATA%; macOS doesn't have a generic equivalent — use $HOME which
# the bootloader does expand on POSIX.
if IS_WINDOWS:
    runtime_tmpdir = '%APPDATA%\\Groundwork\\runtime'
elif IS_MAC:
    runtime_tmpdir = '$HOME/Library/Application Support/Groundwork/runtime'
else:
    runtime_tmpdir = None

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    # On Windows we keep `Groundwork` here; PyInstaller appends .exe on Windows.
    # On Mac the binary is renamed to `Groundwork-mac` by build.yml after
    # the build (PyInstaller doesn't support per-platform name in a single
    # spec) so the two release artifacts don't collide.
    name='Groundwork',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX compresses the binary but triggers more aggressive AV scanning
    # heuristics. We keep it enabled on Windows where it materially shrinks
    # the exe; disable on Mac where Gatekeeper signing matters more than
    # bytes saved.
    upx=IS_WINDOWS,
    upx_exclude=[],
    runtime_tmpdir=runtime_tmpdir,
    console=False,
    disable_windowed_traceback=False,
    # target_arch=universal2 on Mac would build a fat binary covering
    # Intel + Apple Silicon, but requires building Python with the
    # universal2 framework. macos-latest GitHub runners build for the
    # native arch (currently arm64). For initial rollout we ship arm64-
    # only Mac; if any employee has an Intel Mac we add the universal2
    # build flag in a follow-up.
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
    version_file=None,
)
