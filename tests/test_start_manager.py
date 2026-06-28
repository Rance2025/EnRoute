import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from scripts import start_manager
from scripts.start_manager import (
    DEFAULT_API_PORT,
    DEFAULT_FRONTEND_PORT,
    StartConfig,
    build_service_specs,
    get_service_status,
    load_env_file,
    main,
    resolve_start_config,
    start_service,
)


class StartManagerTests(unittest.TestCase):
    def test_load_env_file_ignores_comments_and_unquotes_values(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            env_path = Path(temporary_directory) / ".env.local"
            env_path.write_text(
                "\n".join(
                    [
                        "# local settings",
                        "VITE_AMAP_KEY='abc'",
                        'VITE_AMAP_SECURITY_CODE="def"',
                        "FOOTPRINT_DATA_PATH=external/sample.csv",
                        "invalid-line",
                    ],
                ),
                encoding="utf-8",
            )

            self.assertEqual(
                load_env_file(env_path),
                {
                    "VITE_AMAP_KEY": "abc",
                    "VITE_AMAP_SECURITY_CODE": "def",
                    "FOOTPRINT_DATA_PATH": "external/sample.csv",
                },
            )

    def test_resolve_start_config_uses_env_file_and_cli_overrides(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            (root_dir / ".env.local").write_text(
                "\n".join(
                    [
                        "ENROUTE_API_HOST=0.0.0.0",
                        "ENROUTE_API_PORT=5278",
                        "ENROUTE_FRONTEND_PORT=5273",
                    ],
                ),
                encoding="utf-8",
            )

            from_env_file = resolve_start_config(root_dir=root_dir, environ={})
            self.assertEqual(from_env_file.host, "0.0.0.0")
            self.assertEqual(from_env_file.api_port, 5278)
            self.assertEqual(from_env_file.frontend_port, 5273)

            from_cli = resolve_start_config(
                root_dir=root_dir,
                environ={"ENROUTE_API_PORT": "5378"},
                host="127.0.0.1",
                frontend_port=5373,
                api_port=5478,
            )
            self.assertEqual(from_cli.host, "127.0.0.1")
            self.assertEqual(from_cli.api_port, 5478)
            self.assertEqual(from_cli.frontend_port, 5373)

    def test_build_service_specs_wires_ports_and_proxy_environment(self):
        root_dir = Path("D:/repo")
        config = StartConfig(
            root_dir=root_dir,
            runtime_dir=root_dir / "output" / "start-manager",
            host="127.0.0.1",
            frontend_port=5313,
            api_port=5318,
        )

        specs = build_service_specs(
            config,
            base_env={"FOOTPRINT_DATA_PATH": "external/sample.csv"},
            npm_command="npm",
            python_command="python",
        )
        by_name = {spec.name: spec for spec in specs}

        self.assertEqual(by_name["api"].command, ["python", "scripts/api_server.py"])
        self.assertEqual(
            by_name["frontend"].command,
            ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "5313"],
        )
        self.assertEqual(by_name["frontend"].cwd, root_dir / "apps" / "web")
        self.assertEqual(by_name["api"].env["ENROUTE_API_HOST"], "127.0.0.1")
        self.assertEqual(by_name["api"].env["ENROUTE_API_PORT"], "5318")
        self.assertTrue(by_name["api"].env["PYTHONPATH"].endswith("apps\\api\\src"))
        self.assertEqual(by_name["frontend"].env["ENROUTE_API_PORT"], "5318")
        self.assertEqual(by_name["frontend"].url, "http://127.0.0.1:5313")
        self.assertEqual(by_name["api"].url, "http://127.0.0.1:5318")

    def test_service_status_marks_stale_pid_files(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            runtime_dir = Path(temporary_directory)
            config = StartConfig(
                root_dir=runtime_dir,
                runtime_dir=runtime_dir,
                host="127.0.0.1",
                frontend_port=DEFAULT_FRONTEND_PORT,
                api_port=DEFAULT_API_PORT,
            )
            spec = build_service_specs(
                config,
                base_env={},
                npm_command="npm",
                python_command="python",
            )[0]
            spec.pid_file.write_text("12345", encoding="utf-8")

            status = get_service_status(spec, is_pid_running=lambda pid: False)

            self.assertEqual(status.pid, 12345)
            self.assertFalse(status.running)
            self.assertTrue(status.stale)

    def test_start_service_reports_listener_pid_for_unmanaged_open_port(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            runtime_dir = Path(temporary_directory)
            config = StartConfig(
                root_dir=runtime_dir,
                runtime_dir=runtime_dir,
                host="127.0.0.1",
                frontend_port=DEFAULT_FRONTEND_PORT,
                api_port=DEFAULT_API_PORT,
            )
            spec = build_service_specs(
                config,
                base_env={},
                npm_command="npm",
                python_command="python",
            )[0]

            with (
                patch("scripts.start_manager.is_port_open", return_value=True),
                patch("scripts.start_manager.find_port_listener_pids", return_value=[24680], create=True),
            ):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "api port 5178 is already open by pid=24680 but no managed pid file is running",
                ):
                    start_service(spec)

    def test_parse_windows_netstat_listener_pids_matches_port_and_loopback_host(self):
        output = "\n".join(
            [
                "  Proto  Local Address          Foreign Address        State           PID",
                "  TCP    127.0.0.1:5178         0.0.0.0:0              LISTENING       24680",
                "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       13579",
                "  TCP    0.0.0.0:5178           0.0.0.0:0              LISTENING       11223",
                "  TCP    [::1]:5178             [::]:0                 LISTENING       97531",
                "  TCP    127.0.0.1:5178         127.0.0.1:60000        ESTABLISHED     11111",
            ],
        )

        self.assertEqual(
            start_manager.parse_windows_netstat_listener_pids(output, "127.0.0.1", 5178),
            [24680, 11223],
        )

    def test_main_accepts_explicit_root_dir_for_absolute_entrypoint_execution(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root_dir = Path(temporary_directory)
            stdout = StringIO()

            with redirect_stdout(stdout):
                exit_code = main(["--runtime-dir", "output/test-status", "status"], root_dir=root_dir)

            self.assertEqual(exit_code, 0)
            self.assertIn("api: stopped http://127.0.0.1:5178", stdout.getvalue())
            self.assertIn("frontend: stopped http://127.0.0.1:5173", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
