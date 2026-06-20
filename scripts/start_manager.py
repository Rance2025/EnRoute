from __future__ import annotations

import argparse
import ctypes
import os
import signal
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence

DEFAULT_HOST = "127.0.0.1"
DEFAULT_FRONTEND_PORT = 5173
DEFAULT_API_PORT = 5178
DEFAULT_RUNTIME_DIR = Path("output") / "start-manager"
DEFAULT_START_TIMEOUT_SECONDS = 25


@dataclass(frozen=True)
class StartConfig:
  root_dir: Path
  runtime_dir: Path
  host: str
  frontend_port: int
  api_port: int


@dataclass(frozen=True)
class ServiceSpec:
  name: str
  command: list[str]
  cwd: Path
  env: dict[str, str]
  pid_file: Path
  stdout_log: Path
  stderr_log: Path
  host: str
  port: int
  url: str


@dataclass(frozen=True)
class ServiceStatus:
  name: str
  pid: int | None
  running: bool
  stale: bool
  url: str


def load_env_file(env_path: Path) -> dict[str, str]:
  if not env_path.exists():
    return {}

  values: dict[str, str] = {}
  for line in env_path.read_text(encoding="utf-8").splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
      continue

    separator_index = stripped.find("=")
    if separator_index < 1:
      continue

    key = stripped[:separator_index].strip()
    value = stripped[separator_index + 1 :].strip()
    values[key] = unquote_env_value(value)

  return values


def resolve_start_config(
  *,
  root_dir: Path | str,
  environ: Mapping[str, str],
  host: str | None = None,
  frontend_port: int | None = None,
  api_port: int | None = None,
  runtime_dir: Path | str | None = None,
) -> StartConfig:
  resolved_root_dir = Path(root_dir).resolve()
  env_values = load_env_file(resolved_root_dir / ".env.local")
  merged_env = {**env_values, **dict(environ)}

  resolved_host = host or merged_env.get("ENROUTE_API_HOST") or DEFAULT_HOST
  resolved_frontend_port = (
    frontend_port
    if frontend_port is not None
    else parse_port(merged_env.get("ENROUTE_FRONTEND_PORT"), DEFAULT_FRONTEND_PORT)
  )
  resolved_api_port = (
    api_port
    if api_port is not None
    else parse_port(merged_env.get("ENROUTE_API_PORT"), DEFAULT_API_PORT)
  )
  runtime_path = Path(runtime_dir or merged_env.get("ENROUTE_RUNTIME_DIR") or DEFAULT_RUNTIME_DIR)
  if not runtime_path.is_absolute():
    runtime_path = resolved_root_dir / runtime_path

  return StartConfig(
    root_dir=resolved_root_dir,
    runtime_dir=runtime_path,
    host=resolved_host,
    frontend_port=validate_port(resolved_frontend_port),
    api_port=validate_port(resolved_api_port),
  )


def build_service_specs(
  config: StartConfig,
  *,
  base_env: Mapping[str, str],
  npm_command: str | None = None,
  python_command: str | None = None,
) -> list[ServiceSpec]:
  service_env = {str(key): str(value) for key, value in base_env.items()}
  service_env.update(
    {
      "ENROUTE_API_HOST": config.host,
      "ENROUTE_API_PORT": str(config.api_port),
      "ENROUTE_FRONTEND_PORT": str(config.frontend_port),
    },
  )
  service_env["PYTHONPATH"] = join_python_path(
    config.root_dir / "apps" / "api" / "src",
    service_env.get("PYTHONPATH"),
  )

  display_host = to_display_host(config.host)
  npm = npm_command or default_npm_command()
  python = python_command or sys.executable

  return [
    ServiceSpec(
      name="api",
      command=[python, "scripts/api_server.py"],
      cwd=config.root_dir,
      env=service_env.copy(),
      pid_file=config.runtime_dir / "api.pid",
      stdout_log=config.runtime_dir / "api.log",
      stderr_log=config.runtime_dir / "api.err.log",
      host=config.host,
      port=config.api_port,
      url=f"http://{display_host}:{config.api_port}",
    ),
    ServiceSpec(
      name="frontend",
      command=[
        npm,
        "run",
        "dev",
        "--",
        "--host",
        config.host,
        "--port",
        str(config.frontend_port),
      ],
      cwd=config.root_dir / "apps" / "web",
      env=service_env.copy(),
      pid_file=config.runtime_dir / "frontend.pid",
      stdout_log=config.runtime_dir / "frontend.log",
      stderr_log=config.runtime_dir / "frontend.err.log",
      host=config.host,
      port=config.frontend_port,
      url=f"http://{display_host}:{config.frontend_port}",
    ),
  ]


def get_service_status(
  spec: ServiceSpec,
  *,
  is_pid_running: Callable[[int], bool] | None = None,
) -> ServiceStatus:
  pid_running = is_pid_running or is_process_running
  pid = read_pid_file(spec.pid_file)
  running = pid is not None and pid_running(pid)
  stale = spec.pid_file.exists() and not running

  return ServiceStatus(
    name=spec.name,
    pid=pid,
    running=running,
    stale=stale,
    url=spec.url,
  )


def create_base_env(root_dir: Path, environ: Mapping[str, str]) -> dict[str, str]:
  return {
    **load_env_file(root_dir / ".env.local"),
    **{str(key): str(value) for key, value in environ.items()},
  }


def start_services(specs: Sequence[ServiceSpec], timeout_seconds: float) -> int:
  started_specs: list[ServiceSpec] = []

  try:
    for spec in specs:
      started = start_service(spec)
      if started:
        started_specs.append(spec)

    for spec in specs:
      if not wait_for_port(spec.host, spec.port, timeout_seconds):
        raise RuntimeError(f"{spec.name} did not open port {spec.port} within {timeout_seconds:g}s")

    for spec in specs:
      status = get_service_status(spec)
      print(format_status(status))
    return 0
  except Exception as error:
    print(f"start failed: {error}", file=sys.stderr)
    for spec in reversed(started_specs):
      stop_service(spec)
    return 1


def stop_services(specs: Sequence[ServiceSpec], timeout_seconds: float) -> int:
  exit_code = 0
  for spec in specs:
    try:
      stop_service(spec, timeout_seconds=timeout_seconds)
    except Exception as error:
      exit_code = 1
      print(f"stop failed for {spec.name}: {error}", file=sys.stderr)

  for spec in specs:
    print(format_status(get_service_status(spec)))
  return exit_code


def print_status(specs: Sequence[ServiceSpec]) -> int:
  for spec in specs:
    print(format_status(get_service_status(spec)))
  return 0


def main(argv: Sequence[str] | None = None, *, root_dir: Path | str | None = None) -> int:
  args = parse_args(argv)
  config = resolve_start_config(
    root_dir=root_dir or Path.cwd(),
    environ=os.environ,
    host=args.host,
    frontend_port=args.frontend_port,
    api_port=args.api_port,
    runtime_dir=args.runtime_dir,
  )
  specs = build_service_specs(config, base_env=create_base_env(config.root_dir, os.environ))

  if args.command == "status":
    return print_status(specs)
  if args.command == "stop":
    return stop_services(specs, args.timeout)
  if args.command == "restart":
    stop_code = stop_services(specs, args.timeout)
    start_code = start_services(specs, args.timeout)
    return start_code or stop_code

  return start_services(specs, args.timeout)


def start_service(spec: ServiceSpec) -> bool:
  status = get_service_status(spec)
  if status.running:
    print(f"{spec.name}: already running pid={status.pid} {spec.url}")
    return False

  if status.stale:
    spec.pid_file.unlink(missing_ok=True)

  if is_port_open(spec.host, spec.port):
    raise RuntimeError(
      f"{spec.name} port {spec.port} is already open but no managed pid file is running",
    )

  spec.pid_file.parent.mkdir(parents=True, exist_ok=True)
  spec.stdout_log.parent.mkdir(parents=True, exist_ok=True)
  with spec.stdout_log.open("ab") as stdout, spec.stderr_log.open("ab") as stderr:
    process = subprocess.Popen(
      spec.command,
      cwd=spec.cwd,
      env=spec.env,
      stdin=subprocess.DEVNULL,
      stdout=stdout,
      stderr=stderr,
      creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
      start_new_session=os.name != "nt",
    )

  spec.pid_file.write_text(f"{process.pid}\n", encoding="utf-8")
  print(f"{spec.name}: started pid={process.pid} {spec.url}")
  return True


def stop_service(spec: ServiceSpec, timeout_seconds: float = DEFAULT_START_TIMEOUT_SECONDS) -> None:
  status = get_service_status(spec)
  if status.pid is None:
    return

  if not status.running:
    spec.pid_file.unlink(missing_ok=True)
    return

  terminate_process_tree(status.pid)
  wait_for_process_exit(status.pid, timeout_seconds)
  spec.pid_file.unlink(missing_ok=True)


def terminate_process_tree(pid: int) -> None:
  if os.name == "nt":
    subprocess.run(
      ["taskkill", "/PID", str(pid), "/T", "/F"],
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
      check=False,
    )
    return

  try:
    os.killpg(pid, signal.SIGTERM)
  except ProcessLookupError:
    return

  time.sleep(0.5)
  if is_process_running(pid):
    os.killpg(pid, signal.SIGKILL)


def wait_for_process_exit(pid: int, timeout_seconds: float) -> None:
  deadline = time.monotonic() + timeout_seconds
  while time.monotonic() < deadline:
    if not is_process_running(pid):
      return
    time.sleep(0.1)


def wait_for_port(host: str, port: int, timeout_seconds: float) -> bool:
  deadline = time.monotonic() + timeout_seconds
  while time.monotonic() < deadline:
    if is_port_open(host, port):
      return True
    time.sleep(0.2)

  return False


def is_port_open(host: str, port: int) -> bool:
  try:
    with socket.create_connection((to_connect_host(host), port), timeout=0.3):
      return True
  except OSError:
    return False


def is_process_running(pid: int) -> bool:
  if pid <= 0:
    return False

  if os.name == "nt":
    process_query_limited_information = 0x1000
    handle = ctypes.windll.kernel32.OpenProcess(
      process_query_limited_information,
      False,
      int(pid),
    )
    if not handle:
      return False
    ctypes.windll.kernel32.CloseHandle(handle)
    return True

  try:
    os.kill(pid, 0)
    return True
  except OSError:
    return False


def read_pid_file(pid_file: Path) -> int | None:
  if not pid_file.exists():
    return None

  try:
    return int(pid_file.read_text(encoding="utf-8").strip())
  except ValueError:
    return None


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Start, stop, or restart the EnRoute dev stack.")
  parser.add_argument(
    "command",
    choices=["start", "stop", "restart", "status"],
    nargs="?",
    default="start",
  )
  parser.add_argument("--host", help="Bind host for both services.")
  parser.add_argument("--frontend-port", type=int, help="Vite frontend port.")
  parser.add_argument("--api-port", type=int, help="Local footprints API port.")
  parser.add_argument("--runtime-dir", type=Path, help="Directory for pid and log files.")
  parser.add_argument(
    "--timeout",
    type=float,
    default=DEFAULT_START_TIMEOUT_SECONDS,
    help="Seconds to wait for service start or stop.",
  )
  return parser.parse_args(argv)


def parse_port(value: str | None, fallback: int) -> int:
  if value is None or value == "":
    return fallback

  return validate_port(int(value))


def validate_port(port: int) -> int:
  if port < 1 or port > 65535:
    raise ValueError(f"invalid port: {port}")

  return port


def default_npm_command() -> str:
  return "npm.cmd" if os.name == "nt" else "npm"


def join_python_path(path: Path, existing_path: str | None) -> str:
  resolved_path = str(path)
  if not existing_path:
    return resolved_path

  return os.pathsep.join([resolved_path, existing_path])


def to_connect_host(host: str) -> str:
  return "127.0.0.1" if host == "0.0.0.0" else host


def to_display_host(host: str) -> str:
  return to_connect_host(host)


def unquote_env_value(value: str) -> str:
  if (value.startswith('"') and value.endswith('"')) or (
    value.startswith("'") and value.endswith("'")
  ):
    return value[1:-1]

  return value


def format_status(status: ServiceStatus) -> str:
  if status.running:
    return f"{status.name}: running pid={status.pid} {status.url}"
  if status.stale:
    return f"{status.name}: stopped stale_pid={status.pid} {status.url}"

  return f"{status.name}: stopped {status.url}"


if __name__ == "__main__":
  raise SystemExit(main())
