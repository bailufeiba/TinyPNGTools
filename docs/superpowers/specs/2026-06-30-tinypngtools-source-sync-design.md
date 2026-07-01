# TinyPNGTools --source 同步模式设计文档

## 目标

为 TinyPNGTools 新增 --source 命令行参数，支持从一个外部源目录同步图片到压缩流程。
无 --source 参数时，工具保持原有行为不变。

## 运行方式

原有模式（不变）：

```cmd
node TinyPNGTools.js
```

同步模式：

```cmd
node TinyPNGTools.js --source D:\my-images
```

## 同步模式流程

1. 解析 --source 参数，校验目录存在。
2. 扫描源目录下支持的图片格式，生成 todo.json：{ "files": [{"path": "nested/photo.png", "md5": "..."}] }。
   path 为相对于源目录的路径。
3. 读取 SRC_PNG.json（不存在视为空文件列表）。
4. 以 path 为键对比差异：
   - todo.json 有且 SRC_PNG.json 无，或两者 MD5 不同 → 从源目录复制到 SRC_PNG 同 path，删除 OUT_PNG 对应文件。
   - 其他情况（SRC_PNG.json 有但 todo.json 无，或两者都有且 MD5 相同）→ 跳过。
5. 执行原有压缩流程（包括断点续处理、失败重试等）。
6. 单个文件压缩成功后，更新 SRC_PNG.json（新增或更新对应 path 的 md5）。
7. 所有压缩完成后删除 todo.json。
8. 将本次差异文件（步骤4中复制到 SRC_PNG 的文件）的压缩结果从 OUT_PNG 复制回源目录的同 path 位置。

## 数据结构

SRC_PNG.json 和 todo.json 格式一致：

```json
{
  "files": [
    { "path": "nested/photo.png", "md5": "d41d8cd98f00b204e9800998ecf8427e" }
  ]
}
```

文件名对比以 path 字段为唯一键。

## 新增函数

- generateFileList(dirPath, extensions) → 递归扫描，返回 { files: [{path, md5}] }。
- syncSourceToWorkDirs(baseDir, sourceDir, extensions) → 生成 todo.json、对比 SRC_PNG.json、复制差异文件到 SRC_PNG、清理 OUT_PNG 中对应文件。返回差异文件列表供步骤8使用。
- updateSrcPngJson(baseDir, relativePath, md5) → 读取 SRC_PNG.json，追加或更新对应 path 的 md5，写回文件。
- copyOutputsToSource(baseDir, sourceDir, changedFiles) → 将差异文件的 OUT_PNG 结果复制回源目录。

## 现有流程改动

- main() 新增 --source 参数解析。
- compressSourceFile 成功后调用 updateSrcPngJson。
- 首次运行且无 SRC_PNG.json 时视为空列表，正常生成。

## 错误处理

- --source 指定目录不存在或不可读 → 打印中文错误并退出。
- 复制文件到 SRC_PNG 或源目录失败 → 打印错误但继续处理其他文件。
- SRC_PNG.json 格式损坏 → 视为空列表并覆盖写入。
