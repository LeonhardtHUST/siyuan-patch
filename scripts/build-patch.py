#!/usr/bin/env python3
"""生成 v2 patch：registry + 导出烘焙"""
import shutil, subprocess, sys, os

PW = "/tmp/pw"
SRC = f"{PW}/siyuan-src"
STAGE = f"{PW}/stage"
BUILD = f"{PW}/patchbuild"

MODIFIED = {
    "app/src/protyle/render/mathRender.ts": f"{STAGE}/mathRender.ts",
    "app/src/plugin/index.ts": f"{STAGE}/plugin-index.ts",
    "app/src/protyle/export/index.ts": f"{STAGE}/export-index.ts",
}
NEW = {
    "app/src/protyle/render/mathRendererRegistry.ts": f"{STAGE}/mathRendererRegistry.ts",
    "app/src/protyle/render/mathBoundaries.ts": f"{STAGE}/mathBoundaries.ts",
}

shutil.rmtree(BUILD, ignore_errors=True)
for rel in list(MODIFIED) + list(NEW):
    dst = os.path.join(BUILD, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
# 基线：pristine 源文件（只放将要改动的）
for rel in MODIFIED:
    shutil.copy2(os.path.join(SRC, rel), os.path.join(BUILD, rel))

subprocess.run(["git", "init", "-q"], cwd=BUILD, check=True)
subprocess.run(["git", "add", "-A"], cwd=BUILD, check=True)
subprocess.run(["git", "-c", "user.email=patch@local", "-c", "user.name=patch",
                "commit", "-qm", "base"], cwd=BUILD, check=True)

for rel, staged in MODIFIED.items():
    shutil.copy2(staged, os.path.join(BUILD, rel))
for rel, staged in NEW.items():
    dst = os.path.join(BUILD, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(staged, dst)

subprocess.run(["git", "add", "-A"], cwd=BUILD, check=True)
diff = subprocess.run(["git", "diff", "--cached"], cwd=BUILD, check=True,
                      capture_output=True, text=True).stdout
out = f"{PW}/math-renderer-registry.patch"
with open(out, "w", encoding="utf-8") as f:
    f.write(diff)
print(f"patch: {out} ({len(diff)} bytes)")

subprocess.run(["git", "reset", "-q", "--hard", "HEAD"], cwd=BUILD, check=True)
chk = subprocess.run(["git", "apply", "--check", out], cwd=BUILD, capture_output=True, text=True)
print("git apply --check:", "OK" if chk.returncode == 0 else "FAIL\n" + chk.stderr)
if chk.returncode != 0:
    sys.exit(1)
subprocess.run(["git", "apply", out], cwd=BUILD, check=True)
print(subprocess.run(["git", "status", "--short"], cwd=BUILD, capture_output=True, text=True).stdout)
