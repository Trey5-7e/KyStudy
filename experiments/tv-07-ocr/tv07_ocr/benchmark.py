from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from importlib.metadata import version
from pathlib import Path
from typing import Any, TextIO

import psutil

from tv07_ocr.metrics import character_error_rate, keyword_recall

READ_TIMEOUT_SECONDS = 60


def _read_json_line(
    process: subprocess.Popen[str],
    stream: TextIO,
    timeout_seconds: float,
) -> dict[str, Any]:
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(stream.readline)
        try:
            line = future.result(timeout=timeout_seconds)
        except TimeoutError as error:
            process.kill()
            future.result(timeout=5)
            raise RuntimeError("OCR worker response timed out") from error
    if len(line) == 0:
        stderr = process.stderr.read(500) if process.stderr is not None else ""
        raise RuntimeError(f"OCR worker stopped unexpectedly: {stderr}")
    value = json.loads(line)
    if not isinstance(value, dict):
        raise RuntimeError("OCR worker returned a non-object")
    return value


class WorkerSession:
    def __init__(self, python_executable: Path) -> None:
        environment = os.environ.copy()
        environment["PYTHONUTF8"] = "1"
        self._process = subprocess.Popen(
            [str(python_executable), "-m", "tv07_ocr.worker", "serve"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env=environment,
        )
        if self._process.stdin is None or self._process.stdout is None:
            self._process.kill()
            raise RuntimeError("OCR worker pipes are unavailable")
        self._stdin = self._process.stdin
        self._stdout = self._process.stdout
        self._peak_rss = 0
        self._monitor_stop = threading.Event()
        self._monitor = threading.Thread(target=self._monitor_memory, daemon=True)
        self._monitor.start()
        self.ready = _read_json_line(
            self._process,
            self._stdout,
            READ_TIMEOUT_SECONDS,
        )

    @property
    def peak_rss_mib(self) -> float:
        return self._peak_rss / (1024 * 1024)

    def _monitor_memory(self) -> None:
        target = psutil.Process(self._process.pid)
        while not self._monitor_stop.wait(0.01):
            try:
                processes = [target, *target.children(recursive=True)]
            except psutil.NoSuchProcess:
                return
            current_rss = 0
            for process in processes:
                try:
                    current_rss += process.memory_info().rss
                except (psutil.AccessDenied, psutil.NoSuchProcess):
                    continue
            self._peak_rss = max(self._peak_rss, current_rss)

    def recognize(self, request_id: str, image_path: Path) -> dict[str, Any]:
        self._stdin.write(
            json.dumps(
                {"id": request_id, "image": str(image_path)},
                ensure_ascii=False,
            )
            + "\n"
        )
        self._stdin.flush()
        return _read_json_line(self._process, self._stdout, READ_TIMEOUT_SECONDS)

    def close(self) -> None:
        if self._process.poll() is None:
            self._stdin.write('{"id":"shutdown","command":"shutdown"}\n')
            self._stdin.flush()
            _read_json_line(self._process, self._stdout, 10)
            self._process.wait(timeout=10)
        self._monitor_stop.set()
        self._monitor.join(timeout=2)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _directory_size(path: Path) -> int:
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())


def _sample_result(
    session: WorkerSession,
    sample: dict[str, Any],
    fixtures_dir: Path,
    iterations: int,
) -> dict[str, Any]:
    image_path = (fixtures_dir / sample["filename"]).resolve(strict=True)
    durations: list[float] = []
    response: dict[str, Any] = {}
    for iteration in range(iterations):
        started = time.perf_counter()
        response = session.recognize(
            f"{sample['category']}-{iteration}",
            image_path,
        )
        durations.append((time.perf_counter() - started) * 1000)
    if "error" in response:
        return {
            "filename": sample["filename"],
            "category": sample["category"],
            "error": response["error"],
        }
    recognized_text = "\n".join(line["text"] for line in response["lines"])
    boxes_valid = all(
        0 <= line["box"]["x"] <= 1
        and 0 <= line["box"]["y"] <= 1
        and 0 < line["box"]["width"] <= 1
        and 0 < line["box"]["height"] <= 1
        and line["box"]["x"] + line["box"]["width"] <= 1.000001
        and line["box"]["y"] + line["box"]["height"] <= 1.000001
        for line in response["lines"]
    )
    return {
        "filename": sample["filename"],
        "category": sample["category"],
        "sha256": _sha256(image_path),
        "width": response["width"],
        "height": response["height"],
        "lineCount": len(response["lines"]),
        "recognizedText": recognized_text,
        "characterErrorRate": round(
            character_error_rate(sample["text"], recognized_text),
            4,
        ),
        "keywordRecall": round(keyword_recall(sample["keywords"], recognized_text), 4),
        "meanConfidence": round(
            statistics.fmean(line["confidence"] for line in response["lines"])
            if len(response["lines"]) > 0
            else 0,
            4,
        ),
        "meanWallMs": round(statistics.fmean(durations), 2),
        "maxWallMs": round(max(durations), 2),
        "lastInferenceMs": response["elapsedMs"],
        "normalizedBoxesValid": boxes_valid,
        "formulaDegradeExpected": sample["formula_degrade_expected"],
    }


def _offline_run(python_executable: Path, image_path: Path) -> dict[str, Any]:
    environment = os.environ.copy()
    environment.update(
        {
            "HTTP_PROXY": "http://127.0.0.1:9",
            "HTTPS_PROXY": "http://127.0.0.1:9",
            "NO_PROXY": "",
            "PYTHONUTF8": "1",
        }
    )
    started = time.perf_counter()
    completed = subprocess.run(
        [
            str(python_executable),
            "-m",
            "tv07_ocr.worker",
            "once",
            str(image_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=environment,
        timeout=READ_TIMEOUT_SECONDS,
    )
    return {
        "succeeded": completed.returncode == 0 and '"lines":' in completed.stdout,
        "returnCode": completed.returncode,
        "wallMs": round((time.perf_counter() - started) * 1000, 2),
    }


def _cancellation_run(python_executable: Path) -> dict[str, Any]:
    environment = os.environ.copy()
    environment["PYTHONUTF8"] = "1"
    process = subprocess.Popen(
        [str(python_executable), "-m", "tv07_ocr.worker", "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=environment,
    )
    time.sleep(0.1)
    started = time.perf_counter()
    process.terminate()
    forced = False
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        forced = True
        process.kill()
        process.wait(timeout=2)
    return {
        "exited": process.poll() is not None,
        "forcedKill": forced,
        "terminationMs": round((time.perf_counter() - started) * 1000, 2),
    }


def run_benchmark(
    python_executable: Path,
    fixtures_dir: Path,
    output_path: Path,
    iterations: int,
) -> dict[str, Any]:
    manifest = json.loads((fixtures_dir / "ground_truth.json").read_text(encoding="utf-8"))
    session = WorkerSession(python_executable)
    try:
        samples = [
            _sample_result(session, sample, fixtures_dir, iterations)
            for sample in manifest["samples"]
        ]
    finally:
        session.close()
    result = {
        "environment": {
            "os": platform.platform(),
            "processor": platform.processor(),
            "python": platform.python_version(),
            "rapidocr": version("rapidocr"),
            "onnxruntime": version("onnxruntime"),
            "opencvPython": version("opencv-python"),
            "environmentBytes": _directory_size(Path(sys.prefix)),
        },
        "worker": {
            "engine": session.ready["engine"],
            "initializationMs": session.ready["initializationMs"],
            "peakRssMiB": round(session.peak_rss_mib, 2),
        },
        "samples": samples,
        "offline": _offline_run(
            python_executable,
            (fixtures_dir / manifest["samples"][0]["filename"]).resolve(strict=True),
        ),
        "cancellation": _cancellation_run(python_executable),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=3)
    arguments = parser.parse_args()
    if arguments.iterations < 1 or arguments.iterations > 20:
        raise ValueError("iterations must be between 1 and 20")
    result = run_benchmark(
        arguments.python.resolve(strict=True),
        arguments.fixtures.resolve(strict=True),
        arguments.output.resolve(),
        arguments.iterations,
    )
    sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
