# -*- coding: utf-8 -*-
"""
把多文件 ES module 游戏（含 Three.js）打包成单文件 index.html。
模板为源码页 dev.html；产物写入根目录 index.html 与 deploy-site/index.html。

原理：模块源码以 JSON 字符串内联；import 说明符在构建期改写为
"%%模块名%%" 占位符；运行时按拓扑序创建 Blob URL，并把占位符替换为
真实 blob URL 后 import 主模块。产物可直接双击打开（file://）。
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

MODULES = [
    ("three", ROOT / "vendor" / "three.module.js"),
    ("config", ROOT / "src" / "config.js"),
    ("storage", ROOT / "src" / "storage.js"),
    ("game", ROOT / "src" / "game.js"),
    ("audio", ROOT / "src" / "audio.js"),
    ("input", ROOT / "src" / "input.js"),
    ("effects", ROOT / "src" / "effects.js"),
    ("render3d", ROOT / "src" / "render3d.js"),
    ("net", ROOT / "src" / "net.js"),
    ("ui", ROOT / "src" / "ui.js"),
    ("main", ROOT / "src" / "main.js"),
]

SPEC_MAP = {
    "../vendor/three.module.js": "three",
    "./config.js": "config",
    "./storage.js": "storage",
    "./game.js": "game",
    "./audio.js": "audio",
    "./input.js": "input",
    "./effects.js": "effects",
    "./render3d.js": "render3d",
    "./net.js": "net",
    "./ui.js": "ui",
    "./main.js": "main",
}

FROM_RE = re.compile(r"(from\s*)(['\"])([^'\"]+)\2")


def rewrite(spec_src: str) -> str:
    def sub(match):
        spec = match.group(3)
        if spec not in SPEC_MAP:
            raise SystemExit(f"未知 import 说明符: {spec}")
        return f'{match.group(1)}"%%{SPEC_MAP[spec]}%%"'

    return FROM_RE.sub(sub, spec_src)


def main():
    sources = {}
    order = []
    for name, path in MODULES:
        source = path.read_text(encoding="utf-8")
        if name != "three":
            source = rewrite(source)
        order.append(name)
        sources[name] = json.dumps(source).replace("</", "<\\/")

    order_js = json.dumps(order)
    dict_js = "{" + ",".join(f"{name}:{sources[name]}" for name in order) + "}"
    inline = (
        f"const _order={order_js};\n"
        f"const _src={dict_js};\n"
        "const _urls={};\n"
        "for (const _n of _order) {\n"
        "  const _s=_src[_n].replace(/\"%%([a-z0-9]+)%%\"/g,"
        " (m,d)=>'\"'+_urls[d]+'\"');\n"
        "  _urls[_n]=URL.createObjectURL(new Blob([_s],{type:'text/javascript'}));\n"
        "}\n"
        "import(_urls.main);\n"
    )

    html = (ROOT / "dev.html").read_text(encoding="utf-8")
    css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")

    html = re.sub(r"\n<script data-dev-only>.*?</script>", "", html, flags=re.S)

    link_tag = '<link rel="stylesheet" href="css/style.css">'
    if link_tag not in html:
        sys.exit("dev.html 中未找到样式引用")
    html = html.replace(link_tag, f"<style>\n{css}\n</style>")

    script_tag = '<script type="module" src="src/main.js"></script>'
    if script_tag not in html:
        sys.exit("dev.html 中未找到模块脚本引用")
    html = html.replace(script_tag, f'<script type="module">\n{inline}</script>')

    targets = [ROOT / "index.html", ROOT / "deploy-site" / "index.html"]
    targets[1].parent.mkdir(exist_ok=True)
    for target in targets:
        target.write_text(html, encoding="utf-8")
        size_kb = target.stat().st_size / 1024
        print(f"已生成 {target}（{size_kb:.1f} KB，{len(order)} 个模块）")


if __name__ == "__main__":
    main()