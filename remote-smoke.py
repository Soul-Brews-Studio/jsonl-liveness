"""Real authenticated backend + remote TUI + CLI naming round-trip."""
import json
import os
import pathlib
import pty
import select
import shutil
import subprocess
import tempfile
import time
import urllib.request

app = pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix="jsonl-remote-smoke-") as temp:
    directory = pathlib.Path(temp)
    copy = directory / "app"
    copy.mkdir()
    for path in app.glob("*.ts"):
        shutil.copy2(path, copy / path.name)
    shutil.copy2(app / "package.json", copy / "package.json")
    root = directory / "projects"
    root.mkdir()
    transcript = root / "remote123.jsonl"
    transcript.write_text(json.dumps({'type':'assistant','message':{'role':'assistant','content':'REMOTE LIVE DETAIL'}})+'\n')
    before = (transcript.read_bytes(), transcript.stat().st_mtime_ns)
    env = dict(os.environ, JSONL_TOKEN="fixture-only-token")
    server = subprocess.Popen(["bun", "run", ".", "--serve", "--root", str(root), "--port", "0"], cwd=copy, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    tui = None
    master = None
    try:
        assert select.select([server.stdout], [], [], 5)[0], "server startup timeout"
        line = server.stdout.readline()
        assert line.startswith("JSONL backend + web UI: "), line
        url = line.strip().split(": ", 1)[1]
        master, slave = pty.openpty()
        tui = subprocess.Popen(["bun", "run", ".", "--host", url], cwd=copy, env=env, stdin=slave, stdout=slave, stderr=slave)
        os.close(slave)
        captured = b""
        def until(fragment):
            global captured
            deadline = time.monotonic() + 5
            while fragment not in captured:
                assert time.monotonic() < deadline, repr(captured[-1200:])
                if select.select([master], [], [], .1)[0]:
                    chunk = os.read(master, 65536)
                    assert chunk, "terminal closed"
                    captured += chunk
        until(b"remote123")
        os.write(master, b"\r")
        until(b"JSONL LIVE DETAIL")
        until(b"REMOTE LIVE DETAIL")
        captured = b""
        os.write(master, b"\x1b")
        until(b"SESSION ID")
        os.write(master, b"n")
        until(b"Name (empty clears)")
        os.write(master, b"Remote worker\r")
        until(b"Name saved")
        request = urllib.request.Request(url + "/api/snapshot", headers={"Authorization": "Bearer fixture-only-token"})
        snapshot = json.load(urllib.request.urlopen(request, timeout=5))
        assert snapshot["files"][0]["name"] == "Remote worker"
        result = subprocess.run(["bun", "run", ".", "--host", url, "--once", "--json"], cwd=copy, env=env, capture_output=True, text=True, check=True, timeout=5)
        assert json.loads(result.stdout)["files"][0]["name"] == "Remote worker"
        subprocess.run(["bun", "run", ".", "--host", url, "--name", "remote123", "CLI name"], cwd=copy, env=env, capture_output=True, text=True, check=True, timeout=5)
        until(b"CLI name")
        os.write(master, b"q")
        until(b"\x1b[?1049l")
        tui.wait(timeout=4)
        assert (transcript.read_bytes(), transcript.stat().st_mtime_ns) == before
        print("REMOTE PTY PASS: authenticated backend → TUI rename → HTTP/CLI read → CLI rename → live TUI; transcript unchanged")
    finally:
        if tui and tui.poll() is None:
            tui.terminate()
            tui.wait(timeout=5)
        if master is not None:
            os.close(master)
        server.terminate()
        server.wait(timeout=5)
