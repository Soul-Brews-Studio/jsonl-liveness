"""Isolated Timeline PTY smoke test: python3 tui-timeline-smoke.py (macOS/Linux)."""
import datetime
import fcntl
import json
import os
import pathlib
import pty
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time


app = pathlib.Path(__file__).resolve().parent


def line(value):
    return json.dumps(value, separators=(",", ":")) + "\n"


with tempfile.TemporaryDirectory(prefix="jsonl-tui-timeline-smoke-") as temp:
    temp = pathlib.Path(temp)
    copy = temp / "app"
    copy.mkdir()
    for path in app.glob("*.ts"):
        shutil.copy2(path, copy / path.name)
    shutil.copy2(app / "package.json", copy / "package.json")

    root = temp / "projects"
    alpha = root / "-alpha-project"
    beta = root / "-beta-project"
    subagents = alpha / "subagents"
    subagents.mkdir(parents=True)
    beta.mkdir(parents=True)
    main = alpha / "main-session.jsonl"
    subagent = subagents / "agent-helper.jsonl"
    peer = beta / "peer-session.jsonl"
    main.write_text("".join([
        line({"type": "user", "timestamp": "2026-09-12T01:00:00Z", "message": {"role": "user", "content": "HUMAN TIMELINE EVENT"}}),
        line({"type": "assistant", "timestamp": "2026-09-12T01:01:00Z", "message": {"role": "assistant", "content": "AI TIMELINE EVENT"}}),
        line({"type": "assistant", "timestamp": "2026-09-12T01:02:00Z", "message": {"role": "assistant", "content": [{"type": "tool_use", "name": "Read", "input": {"path": "TIMELINE-TOOL.txt"}}]}}),
        line({"type": "user", "timestamp": "2026-09-12T01:03:00Z", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tool-1", "content": "TOOL RESULT EVENT"}]}}),
    ]))
    subagent.write_text(line({"type": "assistant", "timestamp": "2026-09-12T01:04:00Z", "message": {"role": "assistant", "content": "SUBAGENT TIMELINE EVENT"}}))
    peer.write_text(line({"type": "assistant", "timestamp": "2026-09-12T01:05:00Z", "message": {"role": "assistant", "content": "BETA PROJECT EVENT"}}))
    originals = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in (main, subagent, peer)}
    selected_marker = (
        "> "
        + datetime.datetime.fromisoformat("2026-09-12T01:06:00Z").astimezone().strftime("%Y-%m-%d %H:%M:%S")
    ).encode()

    master, slave = pty.openpty()
    # Timeline controls and footer need a realistically wide terminal.
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 38, 132, 0, 0))
    process = subprocess.Popen(
        ["bun", "run", ".", "--root", str(root)], cwd=copy,
        stdin=slave, stdout=slave, stderr=slave,
    )
    os.close(slave)
    captured = b""
    clear = b"\x1b[H\x1b[2J"

    def read_once(timeout=0.2):
        global captured
        if select.select([master], [], [], timeout)[0]:
            chunk = os.read(master, 65536)
            if not chunk:
                raise AssertionError("terminal closed before expected output")
            captured += chunk
            return True
        return False

    def frame():
        return captured.rsplit(clear, 1)[-1]

    def until(fragment, timeout=6, current_frame=False):
        deadline = time.monotonic() + timeout
        while fragment not in (frame() if current_frame else captured):
            if time.monotonic() > deadline:
                raise AssertionError(f"missing {fragment!r}; current={frame()[-2400:]!r}; history={captured[-8000:]!r}")
            read_once()

    def until_since(fragment, start, timeout=4):
        deadline = time.monotonic() + timeout
        while fragment not in captured[start:]:
            if time.monotonic() > deadline:
                raise AssertionError(f"missing new {fragment!r}: {captured[start:][-4000:]!r}")
            read_once()

    def redraw_count():
        return captured.count(clear)

    def send_and_redraw(keys, timeout=3):
        before = redraw_count()
        os.write(master, keys)
        deadline = time.monotonic() + timeout
        while redraw_count() <= before:
            if time.monotonic() > deadline:
                raise AssertionError(f"no redraw after {keys!r}: {frame()[-2400:]!r}")
            read_once()

    def assert_visible(fragment):
        assert fragment in frame(), f"missing from current frame: {fragment!r}: {frame()[-2400:]!r}"

    def assert_hidden(fragment):
        assert fragment not in frame(), f"unexpected in current frame: {fragment!r}: {frame()[-2400:]!r}"

    def until_hidden(fragment, timeout=3):
        deadline = time.monotonic() + timeout
        while fragment in frame():
            if time.monotonic() > deadline:
                raise AssertionError(f"still visible {fragment!r}: {frame()[-2400:]!r}")
            read_once()

    try:
        until(b"JSONL LIVENESS", current_frame=True)
        assert b"48;2;13;17;23m" in captured
        assert b"48;2;250;247;240m" not in captured

        send_and_redraw(b"t")
        until(b"TIMELINE", current_frame=True)
        for event in (b"HUMAN TIMELINE EVENT", b"AI TIMELINE EVENT", b"TIMELINE-TOOL.txt",
                      b"TOOL RESULT EVENT", b"SUBAGENT TIMELINE EVENT", b"BETA PROJECT EVENT"):
            until(event, current_frame=True)

        # Completed appends become visible; an unterminated record remains held back.
        with main.open("a") as stream:
            stream.write(line({"type": "assistant", "timestamp": "2026-09-12T01:06:00Z", "message": {"role": "assistant", "content": "COMPLETE LIVE TIMELINE APPEND"}}))
        until(b"COMPLETE LIVE TIMELINE APPEND", timeout=6, current_frame=True)
        with main.open("a") as stream:
            stream.write(json.dumps({"type": "assistant", "timestamp": "2026-09-12T01:07:00Z", "message": {"role": "assistant", "content": "HELD TIMELINE PARTIAL"}}))
        before = redraw_count()
        deadline = time.monotonic() + 5
        while redraw_count() <= before and time.monotonic() < deadline:
            read_once()
        assert redraw_count() > before, "timeline did not poll after partial append"
        assert_hidden(b"HELD TIMELINE PARTIAL")
        with main.open("a") as stream:
            stream.write("\n")
        until(b"HELD TIMELINE PARTIAL", timeout=6, current_frame=True)

        # Each numbered filter hides exactly its corresponding event class.
        for key, event in ((b"1", b"HUMAN TIMELINE EVENT"), (b"2", b"AI TIMELINE EVENT"),
                           (b"3", b"TIMELINE-TOOL.txt"), (b"4", b"COMPLETE LIVE TIMELINE APPEND"),
                           (b"5", b"SUBAGENT TIMELINE EVENT")):
            os.write(master, key)
            until_hidden(event)
            os.write(master, key)
            until(event, current_frame=True)

        # Search applies and clears without leaving Timeline mode.
        send_and_redraw(b"/")
        until(b"Search", current_frame=True)
        os.write(master, b"BETA PROJECT EVENT\r")
        deadline = time.monotonic() + 3
        while b"HUMAN TIMELINE EVENT" in frame():
            if time.monotonic() > deadline:
                raise AssertionError(f"timeline search was not applied: {frame()[-2400:]!r}")
            read_once()
        assert_visible(b"BETA PROJECT EVENT")
        send_and_redraw(b"/")
        os.write(master, b"\x15\r")  # Ctrl-U, Enter
        until(b"HUMAN TIMELINE EVENT", current_frame=True)

        # Project picker: toggle current, all, none, apply, and cancel.
        send_and_redraw(b"g")
        until(b"PROJECT", current_frame=True)
        send_and_redraw(b" ")
        send_and_redraw(b"\r")
        until_hidden(b"TIMELINE PROJECTS")
        until_hidden(b"HUMAN TIMELINE EVENT")
        until(b"BETA PROJECT EVENT", current_frame=True)
        send_and_redraw(b"g")
        send_and_redraw(b"a")
        send_and_redraw(b"\r")
        until_hidden(b"TIMELINE PROJECTS")
        until(b"BETA PROJECT EVENT", current_frame=True)
        send_and_redraw(b"g")
        send_and_redraw(b"n")
        send_and_redraw(b"\r")
        until_hidden(b"TIMELINE PROJECTS")
        until_hidden(b"HUMAN TIMELINE EVENT")
        until_hidden(b"BETA PROJECT EVENT")
        send_and_redraw(b"g")
        send_and_redraw(b"a")
        send_and_redraw(b"\r")
        until_hidden(b"TIMELINE PROJECTS")
        until(b"HUMAN TIMELINE EVENT", current_frame=True)
        send_and_redraw(b"g")
        send_and_redraw(b"n")
        send_and_redraw(b"\x1b")
        until_hidden(b"TIMELINE PROJECTS")
        until(b"HUMAN TIMELINE EVENT", current_frame=True)

        # Pause/follow/limit controls redraw in place; refresh reseeds visible rows.
        send_and_redraw(b"p")
        until(b"PAUSED", current_frame=True)
        os.write(master, b"f")
        until(b"manual", current_frame=True)
        os.write(master, b"f")
        until(b"FOLLOW", current_frame=True)
        os.write(master, b"l")
        until(b"limit 100", current_frame=True)
        os.write(master, b"l")
        until(b"limit 20", current_frame=True)
        os.write(master, b"l")
        until(b"limit 50", current_frame=True)
        refresh_start = len(captured)
        os.write(master, b"r")
        until_since(b"0\xe2\x80\x930 of 0 matching events", refresh_start)
        until(b"COMPLETE LIVE TIMELINE APPEND", current_frame=True)
        os.write(master, b"p")
        until(b"every 2s", current_frame=True)

        # Enter opens the selected session detail; Esc returns to Timeline, then list.
        selection_start = len(captured)
        os.write(master, b"j")
        until_since(selected_marker, selection_start)
        until(selected_marker, current_frame=True)
        os.write(master, b"\r")
        until(b"JSONL LIVE DETAIL", current_frame=True)
        detail_back_start = len(captured)
        os.write(master, b"\x1b")
        until_since(b"JSONL LIVE TIMELINE", detail_back_start)
        until(b"JSONL LIVE TIMELINE", current_frame=True)
        list_back_start = len(captured)
        os.write(master, b"\x1b")
        until_since(b"JSONL LIVENESS", list_back_start)
        until(b"JSONL LIVENESS", current_frame=True)
        os.write(master, b"t")
        until(b"TIMELINE", current_frame=True)

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
        assert process.returncode == 0
        for path, (contents, mtime_ns) in originals.items():
            if path == main:
                assert path.read_bytes().startswith(contents)
            else:
                assert path.read_bytes() == contents
                assert path.stat().st_mtime_ns == mtime_ns
        print("PTY Timeline smoke PASS: dark mode, live/partial append, type/session/project filters, search, pause/follow/refresh/limit, detail return, list return, quit cleanup")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        os.close(master)
