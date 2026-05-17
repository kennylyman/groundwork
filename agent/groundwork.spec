# groundwork.spec
# PyInstaller spec file for building Groundwork Windows agent

block_cipher = None

a = Analysis(
    ['src/main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('src/.env', '.'),
    ],
    hiddenimports=[
        'anthropic',
        'mss',
        'mss.windows',
        'PIL',
        'PIL.Image',
        'pynput',
        'pynput.keyboard',
        'pynput.mouse',
        'pynput.keyboard._win32',
        'pynput.mouse._win32',
        'cryptography',
        'requests',
        'dotenv',
        'psutil',
        'win32gui',
        'win32process',
        'win32con',
        # pywinauto removed — only capture_windows.py used it, which is gone.
        'tkinter',
        'tkinter.ttk',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'pyobjc',
        'pyobjc-core',
        'pyobjc-framework-Quartz',
        'pyobjc-framework-Cocoa',
    ],
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

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='Groundwork',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # Silent — no console window on employee machines
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,              # Add icon path here later
    version_file=None,
)
