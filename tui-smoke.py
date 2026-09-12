"""Isolated real-terminal smoke test: python3 tui-smoke.py (macOS/Linux)."""
import json
import os
import pathlib
import pty
import select
import shutil
import subprocess
import tempfile
import time

app = pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix="jsonl-tui-smoke-") as temp:
    temp = pathlib.Path(temp)
    copy = temp / "app"
    copy.mkdir()
    for path in app.glob("*.ts"):
        shutil.copy2(path, copy / path.name)
    shutil.copy2(app / "package.json", copy / "package.json")
    root = temp / "projects"
    project = root / "-fixture-project"
    project.mkdir(parents=True)
    transcript = project / "session123.jsonl"
    transcript.write_text(json.dumps({'type':'assistant','message':{'role':'assistant','content':'FIRST LIVE MESSAGE'}})+'\n')
    original = transcript.read_bytes()
    original_mtime = transcript.stat().st_mtime_ns
    master, slave = pty.openpty()
    process = subprocess.Popen(
        ["bun", "run", ".", "--root", str(root)], cwd=copy,
        stdin=slave, stdout=slave, stderr=slave,
    )
    os.close(slave)
    captured = b""

    def until(fragment, timeout=5):
        global captured
        deadline = time.monotonic() + timeout
        while fragment not in captured:
            if time.monotonic() > deadline:
                raise AssertionError(f"missing {fragment!r}: {captured[-1800:]!r}")
            if select.select([master], [], [], 0.2)[0]:
                chunk = os.read(master, 65536)
                if not chunk:
                    raise AssertionError("terminal closed before expected output")
                captured += chunk

    try:
        until(b"session123")
        os.write(master, b"\r")
        until(b"JSONL LIVE DETAIL")
        until(b"FIRST LIVE MESSAGE")
        os.write(master, b"t")
        captured = b""
        until(b"48;2;13;17;23m")
        assert b"48;2;250;247;240m" not in captured
        assert b"t theme" not in captured
        assert transcript.read_bytes() == original
        assert transcript.stat().st_mtime_ns == original_mtime
        with transcript.open("a") as stream:
            stream.write(json.dumps({'type':'assistant','message':{'content':'APPENDED LIVE MESSAGE'}})+'\n')
        until(b"APPENDED LIVE MESSAGE")
        captured = b""
        with transcript.open("a") as stream:
            stream.write(json.dumps({'type':'assistant','message':{'content':'HELD PARTIAL MESSAGE'}}))
        until(b"partial line held")
        assert b"HELD PARTIAL MESSAGE" not in captured
        with transcript.open("a") as stream:
            stream.write("\n")
        until(b"HELD PARTIAL MESSAGE")
        original = transcript.read_bytes()
        original_mtime = transcript.stat().st_mtime_ns
        captured = b""
        os.write(master, b"\x1b")
        until(b"SESSION ID")
        os.write(master, b"n")
        until(b"Name (empty clears)")
        os.write(master, b"My lab worker\r")
        until(b"Name saved")
        store = copy / ".local/names.json"
        assert json.loads(store.read_text())[str(transcript)] == "My lab worker"
        assert transcript.read_bytes() == original
        assert transcript.stat().st_mtime_ns == original_mtime
        os.write(master, b"p")
        until(b"PAUSED")
        os.write(master, b"q")
        until(b"\x1b[?1049l")
        process.wait(timeout=4)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and select.select([master], [], [], 0.1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            captured += chunk
        assert b"\x1b[?1049l" in captured and b"\x1b[?25h" in captured
        result = subprocess.run(
            ["bun", "run", ".", "--root", str(root), "--once", "--json"],
            cwd=copy, capture_output=True, text=True, check=True, timeout=5,
        )
        file = json.loads(result.stdout)["files"][0]
        assert file["id"] == "session123" and file["name"] == "My lab worker"
        subprocess.run(
            ["bun", "run", ".", "--root", str(root), "--name", "session123", ""],
            cwd=copy, capture_output=True, check=True, timeout=5,
        )
        assert json.loads(store.read_text()) == {}
        os.close(master)
        master, slave = pty.openpty()
        code = (
            'import {watchTui} from "./tui"; import {defaults} from "./liveness"; '
            'const original = process.stdout.write.bind(process.stdout); '
            'let injected = false; '
            'process.stdout.write = ((chunk, ...args) => { '
            'if (!injected && String(chunk).includes("\\x1b[H")) { injected = true; throw new Error("injected render failure"); } '
            'return original(chunk, ...args); }); '
            'try { await watchTui(' + json.dumps(str(root)) + ', defaults); } '
            'catch (error) { console.log("RESTORED_RAW_" + Boolean(process.stdin.isRaw)); }'
        )
        process = subprocess.Popen(["bun", "-e", code], cwd=copy, stdin=slave, stdout=slave, stderr=slave)
        os.close(slave)
        captured = b""
        until(b"RESTORED_RAW_false")
        assert b"\x1b[?1049l" in captured and b"\x1b[?25h" in captured
        process.wait(timeout=4)
        print("PTY failure-path PASS: injected rendering error restores raw mode, cursor and screen")
        print("PTY smoke PASS: Enter/live append/Esc, dark-only theme, rename, persistence, pause, JSON ID/name, clear, terminal restore; transcript unchanged")
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
        os.close(master)
