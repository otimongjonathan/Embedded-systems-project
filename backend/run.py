"""Start the API (and create the database on first run), then open the docs in the browser.

Usually started by start.bat (Windows) or ./start.sh (macOS/Linux), which use the
project's .venv. Options:
    --port 8001     use another port (default 8000)
    --lan           listen on all network interfaces, so other devices can reach this laptop
    --no-browser    do not open the browser
"""
import argparse
import socket
import sys
import threading
import webbrowser

if sys.version_info < (3, 10):
    sys.exit(f"Python 3.10 or newer is needed, this is {sys.version.split()[0]}. See README section 1.")

try:
    import uvicorn
except ImportError:
    sys.exit("The packages are not installed. Run setup.bat (Windows) or ./setup.sh (macOS/Linux) first.")


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        # Like uvicorn, ignore connections left waiting after a restart (macOS, Linux).
        # Not on Windows, where this option would let two servers share the port.
        if sys.platform != "win32":
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--lan", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    host = "0.0.0.0" if args.lan else "127.0.0.1"
    if not port_free(host, args.port):
        sys.exit(f"Port {args.port} is already in use (is the API already running in another window?).\n"
                 f"Close that window, or start on another port: start.bat --port {args.port + 1}")

    docs = f"http://127.0.0.1:{args.port}/docs"  # not "localhost": on Windows that can resolve to IPv6 first
    print("=" * 64)
    print(f"  API docs:  {docs}")
    print("  Login:     admin / Admin@CoCIS2026   (Authorize button)")
    print("  Device:    esp32-demo-key-change-me")
    print("  Stop:      press Ctrl+C in this window")
    print("=" * 64)
    if not args.no_browser:
        threading.Timer(2.0, webbrowser.open, args=(docs,)).start()
    uvicorn.run("api.main:app", host=host, port=args.port)


if __name__ == "__main__":
    main()
