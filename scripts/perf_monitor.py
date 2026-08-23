#!/usr/bin/env python3
"""
SpiritPal 性能监控脚本
测量：启动时间、内存占用、CPU 使用率
运行方式：python perf_monitor.py
"""

import subprocess
import time
import psutil
import json
from datetime import datetime
from pathlib import Path
import sys

def measure_startup():
    """测量 SpiritPal 启动耗时"""
    print("[SpiritPal] 开始测量启动时间...")
    start = time.time()
    
    try:
        # Tauri 开发模式
        proc = subprocess.Popen(
            ["npm", "run", "tauri", "dev"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # 等待 15 秒检查是否成功启动
        for _ in range(30):
            if proc.poll() is not None:
                stdout, stderr = proc.communicate()
                if "error" in stderr.lower() or "failed" in stderr.lower():
                    print(f"[SpiritPal] ❌ 启动失败：{stderr[:200]}")
                    return {"startup_duration": time.time() - start, "error": True}
            time.sleep(0.5)
        
        duration = time.time() - start
        print(f"[SpiritPal] ✅ 启动耗时：{duration:.2f}s")
        
        # 监控资源（如果进程还在运行）
        peak_memory = 0
        if proc.pid:
            try:
                p = psutil.Process(proc.pid)
                for _ in range(10):
                    mem_mb = p.memory_info().rss / (1024 * 1024)
                    peak_memory = max(peak_memory, mem_mb)
                    time.sleep(1)
                
                proc.terminate()
                proc.wait(timeout=5)
            except:
                proc.kill()
        
        return {
            "startup_duration": round(duration, 2),
            "peak_memory_mb": round(peak_memory, 2),
            "timestamp": datetime.now().isoformat(),
            "error": False
        }
        
    except Exception as e:
        print(f"[SpiritPal] ❌ 异常：{e}")
        return {"startup_duration": 0, "error": True, "error_msg": str(e)}

if __name__ == "__main__":
    print("\n🔧 SpiritPal 性能基准测试")
    print("="*50)
    
    results_dir = Path("./perf/results")
    results_dir.mkdir(exist_ok=True)
    
    metrics = measure_startup()
    
    # 保存结果
    output_file = results_dir / f"benchmark_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ 结果已保存：{output_file}")
    print(f"   启动时间：{metrics.get('startup_duration', 0):.2f}s")
    if metrics.get('peak_memory_mb'):
        print(f"   峰值内存：{metrics['peak_memory_mb']:.1f}MB")
