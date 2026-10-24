# Runs argv[3:] in a pseudo-terminal in cwd argv[1], sends argv[2] (keys) once the confirm prompt appears,
# echoes the terminal output to stdout and exits with the child's status.
import os, pty, select, sys, time

cwd, keys, argv = sys.argv[1], sys.argv[2], sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvp(argv[0], argv)
out = b""
sent = False
deadline = time.time() + 60
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if ready:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
        if not sent and b"to this project?" in out:
            os.write(fd, keys.encode())
            sent = True
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(out)
sys.exit(os.waitstatus_to_exitcode(status))
