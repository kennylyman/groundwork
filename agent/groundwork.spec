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
    # Bootloader extraction target. Default None → %TEMP%\_MEIxxxxxx, a
    # random folder that Windows / antivirus can purge between launches
    # or mid-session (manifested as Chloe's "Failed to load Python DLL"
    # crash in v0.5.5 — _MEI folder was gone by relaunch). The bootloader
    # expands environment variables at runtime, so this becomes
    # C:\Users\<user>\AppData\Roaming\Groundwork\runtime — a persistent
    # location the agent already owns. Bootloader auto-creates the dir
    # if missing on each launch.
    runtime_tmpdir='%APPDATA%\\Groundwork\\runtime',
    console=False,          # Silent — no console window on employee machines
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,              # Add icon path here later
    version_file=None,
)
