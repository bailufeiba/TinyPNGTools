# TinyPNGTools

TinyPNGTools 是一个基于 [TinyPNG / Tinify HTTP API](https://tinify.com/developers) 的批量图片压缩命令行工具，使用纯 Node.js 实现。

支持 `.png`、`.jpg`、`.jpeg`、`.webp` 格式，具备递归扫描、并发压缩、断点续处理、自动重试、失败隔离等能力。

---

## 目录

- [配置](#配置)
- [使用方式](#使用方式)
- [命令参考](#命令参考)
- [目录结构](#目录结构)
- [工作流程](#工作流程)
- [未完成任务处理](#未完成任务处理)
- [自动测试](#自动测试)
- [相关链接](#相关链接)

---

## 配置

复制 `config.example.json` 为 `config.json`，填写你的 TinyPNG API Key：

```json
{
  "apiKey": "YOUR_API_KEY",
  "concurrency": 5,
  "extensions": [".png", ".jpg", ".jpeg", ".webp"],
  "maxRetries": 3
}
```

| 字段 | 说明 |
|------|------|
| `apiKey` | TinyPNG API Key，从 [Tinify Developers](https://tinify.com/developers) 申请 |
| `concurrency` | 并发压缩数，默认 `5` |
| `extensions` | 支持的图片扩展名 |
| `maxRetries` | 单文件最大重试次数，默认 `3` |

---

## 使用方式

### 基础模式

将待压缩图片放入 `SRC_PNG`，运行：

```
node TinyPNGTools.js
```

工具会递归扫描 `SRC_PNG` 中的图片，上传压缩后将结果写入 `OUT_PNG`，保持相对路径一致。

### 源目录同步模式（`--source`）

指向外部图片目录，自动检测新增和修改的文件，压缩后回写：

```
node TinyPNGTools.js --source D:\my-images
```

- 生成 `todo.json` 记录源目录文件信息，与 `SRC_PNG.json` 对比差异
- 仅压缩新增或 **MD5 变化** 的文件
- 压缩完成后结果自动复制回源目录，删除 `todo.json`
- 启动时直接清空 `RETRY_PNG`，不会询问重试

#### 忽略文件

在同步模式下，可指定忽略列表排除某些文件：

```
node TinyPNGTools.js --source D:\my-images --ignore D:\my-images\ignore.json
```

`ignore.json` 格式（路径相对于源目录）：

```json
{
  "ignore": ["nested/photo.png"]
}
```

---

## 命令参考

| 命令 | 说明 |
|------|------|
| `node TinyPNGTools.js` | 基础模式：压缩 `SRC_PNG` 到 `OUT_PNG` |
| `node TinyPNGTools.js --source <dir> [--ignore <path>]` | 同步模式：压缩外部目录差异文件 |
| `node TinyPNGTools.js clear` | 清空所有缓存，强制重新压缩 |
| `node TinyPNGTools.js todolist [sourceDir] [--ignore <path>]` | 扫描目录生成差异列表，写入 `todo.json` |
| 
ode TinyPNGTools.js reset-ignore <path> [clearDir] [sourceDir] | 重置已忽略文件：从 SRC_PNG/OUT_PNG 删除，从 SRC_PNG.json 移除；可选清除外部目录并从来源恢复 |
| `node TinyPNGTools.js --help` / `-h` | 查看帮助信息 |

### clear 命令

清空所有缓存并强制后续重新压缩全部图片。执行后会提示确认：

```
是否清空所有缓存？该行为会导致后续所有PNG重新压缩 (y/n):
```

确认后执行以下操作：

- 清空并重建 `SRC_PNG`、`OUT_PNG`、`RETRY_PNG`、`FAIL_PNG`
- 删除 `todo.json`
- 将 `SRC_PNG.json` 重置为 `{ "files": [] }`

### todolist 命令

扫描指定目录（默认 `SRC_PNG`），与 `SRC_PNG.json` 对比，将差异文件写入 `todo.json` 并输出。

```
node TinyPNGTools.js todolist
node TinyPNGTools.js todolist D:\my-images --ignore D:\my-images\ignore.json
```

执行流程：

1. 扫描源目录中所有支持的图片文件
2. 计算每个文件内容的 MD5
3. 与 `SRC_PNG.json` 中的 `src_md5` / `out_md5` 对比
4. 将 MD5 不匹配的文件列表写入 `todo.json`
5. 在控制台输出 `todo.json` 的内容

---

## 目录结构

### 正式运行目录

```
SRC_PNG/      源图片
OUT_PNG/      压缩输出
RETRY_PNG/    待重试
FAIL_PNG/     重试失败
```

### 自动测试目录

```
TEST/SRC_PNG
TEST/OUT_PNG
TEST/RETRY_PNG
TEST/FAIL_PNG
```

---

## 工作流程

### 启动流程

1. 读取并校验 `config.json`
2. 创建工作目录（正式或测试）
3. 检查 `RETRY_PNG` 是否有待重试文件
4. 进入重试流程或正常压缩流程

### 正常压缩流程

1. 递归扫描 `SRC_PNG` 中符合扩展名的图片
2. 计算相对路径
3. 若 `OUT_PNG` 已存在同路径文件，则跳过（断点续处理）
4. 以 `concurrency` 控制并发数上传压缩
5. 结果写入 `OUT_PNG` 对应路径

### 断点续处理

- `OUT_PNG` 中已存在的文件视为已完成，跳过
- `RETRY_PNG` 中遗留的文件视为未完成失败项，启动时询问是否重试
- `SRC_PNG` 有但 `OUT_PNG` 没有的文件视为未完成，继续压缩

### 失败处理

首次压缩失败时：

1. 将 `SRC_PNG` 中的源文件复制到 `RETRY_PNG` 同路径
2. 进入自动重试队列

自动重试规则：

- 最多重试 `maxRetries` 次（默认 3）
- 重试成功：写入 `OUT_PNG`，删除 `RETRY_PNG` 对应文件
- 重试耗尽：复制源文件到 `FAIL_PNG`，删除 `RETRY_PNG` 中对应文件

### SRC_PNG.json

记录已处理文件的 MD5 哈希：

```json
{
  "files": [
    {
      "path": "GameFramework/Res/FairyGui/ResCommon_atlas0.png",
      "src_md5": "压缩前内容 MD5",
      "out_md5": "压缩后内容 MD5"
    }
  ]
}
```

在 `--source` 模式下：

- 若当前文件 MD5 命中 `src_md5` 或 `out_md5`，且 `OUT_PNG` 中存在同路径缓存文件，则跳过 Tinify 压缩，直接将缓存复制回源目录
- 若 MD5 命中但 `OUT_PNG` 无缓存，仍进入压缩流程
### reset-ignore 命令

根据忽略列表清理已压缩的图片缓存，支持可选的外部目录清除和恢复。

```
node TinyPNGTools.js reset-ignore D:\my-images\ignore.json
node TinyPNGTools.js reset-ignore D:\my-images\ignore.json D:\clear-dir
node TinyPNGTools.js reset-ignore D:\my-images\ignore.json D:\clear-dir D:\source-dir
```

**参数说明**：

| 参数 | 说明 |
|------|------|
| `<path>` | 忽略 JSON 文件路径（必填） |
| `[clearDir]` | 外部清除目录（可选） |
| `[sourceDir]` | 外部来源目录（可选，需与 clearDir 同时使用） |

**执行流程**：

1. 读取 `ignore.json` 中的文件路径
2. 从 `SRC_PNG` 和 `OUT_PNG` 中删除对应文件
3. 从 `SRC_PNG.json` 中移除这些文件的记录
4. 如果传入了 `clearDir`：从 `clearDir` 中删除对应文件（仅父目录存在时执行）
5. 如果同时传入了 `clearDir` 和 `sourceDir`：从 `sourceDir` 复制对应文件到 `clearDir`（自动创建父目录）

下次压缩时被重置的文件会被视为全新文件重新处理。

---

---

## 未完成任务处理

### 基础模式

启动时若检测到 `RETRY_PNG` 中有文件，会询问是否重试：

- **选择重试**：先压缩 `RETRY_PNG` 中的文件，成功后写入 `OUT_PNG` 并删除，再继续处理 `SRC_PNG` 中未输出的文件
- **选择不重试**：只清空 `RETRY_PNG`，保留 `OUT_PNG`，继续处理 `SRC_PNG` 中未输出的文件

### --source 模式

启动后直接清空 `RETRY_PNG`，不会询问重试。按源目录生成 `todo.json` 与 `SRC_PNG.json` 对比，只压缩差异文件。

---

## 自动测试

```
node TEST\run-tests.js
```

自动测试仅操作 `TEST` 目录下的四个子目录，不会影响正式运行目录中的图片。

测试覆盖：

- 配置校验
- 图片扩展名筛选
- 相对路径映射
- 断点续处理跳过逻辑
- 失败文件复制到 `RETRY_PNG`
- 重试成功后写入 `OUT_PNG` 并删除 `RETRY_PNG`
- 重试失败后复制到 `FAIL_PNG` 并删除 `RETRY_PNG`

---

## 相关链接

- [TinyPNG 官网](https://tinypng.com/)
- [API Key 申请](https://tinify.com/developers)
- [API 参考文档](https://tinify.com/developers/reference/http)
