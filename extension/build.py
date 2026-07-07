#!/usr/bin/env python3
"""
CommentMiner 扩展构建脚本
生成 Chrome/Edge 和 Firefox 两个版本的扩展包
"""

import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
DIST = ROOT.parent / "extension-dist"

COMMON_FILES = [
    "background.js",
    "content.js",
    "md.js",
    "popup.html",
    "popup.css",
    "popup.js",
    "sidepanel.html",
    "sidepanel.js",
    "README.md",
]

def build_chrome():
    """构建 Chrome/Edge 版本"""
    dist_dir = DIST / "chrome"
    dist_dir.mkdir(parents=True, exist_ok=True)
    
    # 复制 manifest
    shutil.copy(ROOT / "manifest.json", dist_dir / "manifest.json")
    
    # 复制公共文件
    for f in COMMON_FILES:
        src = ROOT / f
        if src.exists():
            shutil.copy(src, dist_dir / f)
    
    # 复制图标
    icons_src = ROOT / "icons"
    icons_dst = dist_dir / "icons"
    if icons_src.exists():
        shutil.copytree(icons_src, icons_dst, dirs_exist_ok=True)
    
    print(f"[OK] Chrome/Edge 版本已构建: {dist_dir}")
    return dist_dir

def build_firefox():
    """构建 Firefox 版本"""
    dist_dir = DIST / "firefox"
    dist_dir.mkdir(parents=True, exist_ok=True)
    
    # 复制 firefox manifest (重命名为 manifest.json)
    shutil.copy(ROOT / "manifest.firefox.json", dist_dir / "manifest.json")
    
    # 复制公共文件
    for f in COMMON_FILES:
        src = ROOT / f
        if src.exists():
            shutil.copy(src, dist_dir / f)
    
    # 复制图标
    icons_src = ROOT / "icons"
    icons_dst = dist_dir / "icons"
    if icons_src.exists():
        shutil.copytree(icons_src, icons_dst, dirs_exist_ok=True)
    
    print(f"[OK] Firefox 版本已构建: {dist_dir}")
    return dist_dir

def main():
    print("构建 CommentMiner 浏览器扩展...\n")
    
    # 清理旧构建
    if DIST.exists():
        shutil.rmtree(DIST)
    
    build_chrome()
    build_firefox()
    
    print(f"\n构建完成！输出目录: {DIST}")
    print("\n安装方法:")
    print("  Chrome/Edge: chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择 chrome/")
    print("  Firefox: about:debugging → 临时载入附加组件 → 选择 firefox/manifest.json")

if __name__ == "__main__":
    main()
