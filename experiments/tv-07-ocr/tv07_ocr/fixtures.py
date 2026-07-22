from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

DEFAULT_FONT_PATH = "C:/Windows/Fonts/msyh.ttc"


@dataclass(frozen=True)
class Sample:
    filename: str
    category: str
    lines: tuple[str, ...]
    keywords: tuple[str, ...]
    formula_degrade_expected: bool = False


SAMPLES = (
    Sample(
        filename="clean_chinese.png",
        category="clean_print",
        lines=(
            "考研计算机综合复习计划",
            "数据结构：线性表、树、图",
            "计算机组成原理：缓存命中率 95%",
            "操作系统：进程、线程与虚拟内存",
            "计算机网络：TCP/IP 与拥塞控制",
            "每日错题复习 5 道，计划 120 分钟",
        ),
        keywords=("数据结构", "缓存命中率", "虚拟内存", "TCP/IP", "错题复习"),
    ),
    Sample(
        filename="tilted_phone.jpg",
        category="tilted_photo",
        lines=(
            "错题复盘：二叉树遍历",
            "前序：根、左、右",
            "错误原因：递归边界遗漏",
            "下次复习：2026年7月25日",
        ),
        keywords=("二叉树遍历", "前序", "递归边界", "2026年7月25日"),
    ),
    Sample(
        filename="low_resolution_scan.png",
        category="low_resolution",
        lines=(
            "操作系统存储管理",
            "页面大小为 4KB",
            "缺页中断后访问内存",
            "局部性原理决定命中率",
        ),
        keywords=("存储管理", "4KB", "缺页中断", "局部性原理"),
    ),
    Sample(
        filename="formula_table.png",
        category="formula_table",
        lines=(
            "算法与公式整理",
            "递推式 T(n) = 2T(n/2) + n",
            "条件概率 P(A|B) = P(AB) / P(B)",
            "缓存级别    L1    L2    L3",
            "访问周期     4    12    40",
        ),
        keywords=("算法与公式", "T(n)", "P(A|B)", "L1", "访问周期"),
        formula_degrade_expected=True,
    ),
)


def _font(font_path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(font_path), size=size)


def _draw_page(
    lines: tuple[str, ...],
    *,
    font_path: Path,
    width: int,
    height: int,
    font_size: int,
    line_gap: int,
    margin: int,
    background: tuple[int, int, int],
) -> Image.Image:
    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)
    font = _font(font_path, font_size)
    y = margin
    for index, line in enumerate(lines):
        color = (25, 43, 36) if index == 0 else (35, 35, 35)
        draw.text((margin, y), line, font=font, fill=color)
        y += font_size + line_gap
    return image


def _save_clean(sample: Sample, output_dir: Path, font_path: Path) -> None:
    image = _draw_page(
        sample.lines,
        font_path=font_path,
        width=1400,
        height=1800,
        font_size=54,
        line_gap=52,
        margin=110,
        background=(255, 255, 252),
    )
    image.save(output_dir / sample.filename, optimize=True)


def _save_tilted(sample: Sample, output_dir: Path, font_path: Path) -> None:
    page = _draw_page(
        sample.lines,
        font_path=font_path,
        width=1100,
        height=1250,
        font_size=52,
        line_gap=60,
        margin=100,
        background=(247, 243, 231),
    )
    draw = ImageDraw.Draw(page)
    draw.rectangle((55, 55, 1045, 1195), outline=(160, 154, 137), width=3)
    rotated = page.rotate(
        7.0,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=(74, 78, 75),
    )
    softened = (
        ImageEnhance.Contrast(rotated).enhance(0.9).filter(ImageFilter.GaussianBlur(radius=0.45))
    )
    softened.save(output_dir / sample.filename, quality=82, optimize=True)


def _save_low_resolution(sample: Sample, output_dir: Path, font_path: Path) -> None:
    page = _draw_page(
        sample.lines,
        font_path=font_path,
        width=900,
        height=1200,
        font_size=46,
        line_gap=60,
        margin=80,
        background=(246, 246, 243),
    ).convert("L")
    low_resolution = page.resize((300, 400), Image.Resampling.BILINEAR)
    restored = low_resolution.resize((900, 1200), Image.Resampling.BILINEAR)
    draw = ImageDraw.Draw(restored)
    for y in range(12, restored.height, 37):
        draw.line((0, y, restored.width, y), fill=232, width=1)
    restored.save(output_dir / sample.filename, optimize=True)


def _save_formula(sample: Sample, output_dir: Path, font_path: Path) -> None:
    image = _draw_page(
        sample.lines,
        font_path=font_path,
        width=1500,
        height=1700,
        font_size=50,
        line_gap=58,
        margin=100,
        background=(255, 255, 255),
    )
    draw = ImageDraw.Draw(image)
    top = 620
    left = 100
    right = 1380
    bottom = 1040
    draw.rectangle((left, top, right, bottom), outline=(45, 45, 45), width=3)
    for x in (500, 760, 1020):
        draw.line((x, top, x, bottom), fill=(65, 65, 65), width=2)
    for y in (760, 900):
        draw.line((left, y, right, y), fill=(65, 65, 65), width=2)
    image.save(output_dir / sample.filename, optimize=True)


def generate(output_dir: Path, font_path: Path) -> None:
    if not font_path.is_file():
        raise FileNotFoundError(f"Chinese font is missing: {font_path}")
    output_dir.mkdir(parents=True, exist_ok=True)
    _save_clean(SAMPLES[0], output_dir, font_path)
    _save_tilted(SAMPLES[1], output_dir, font_path)
    _save_low_resolution(SAMPLES[2], output_dir, font_path)
    _save_formula(SAMPLES[3], output_dir, font_path)
    manifest = {
        "font": str(font_path),
        "samples": [
            {
                **asdict(sample),
                "text": "\n".join(sample.lines),
            }
            for sample in SAMPLES
        ],
    }
    (output_dir / "ground_truth.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--font", type=Path, default=Path(DEFAULT_FONT_PATH))
    arguments = parser.parse_args()
    generate(arguments.output.resolve(), arguments.font.resolve(strict=True))


if __name__ == "__main__":
    main()
