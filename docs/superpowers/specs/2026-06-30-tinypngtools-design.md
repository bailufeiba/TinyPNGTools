# TinyPNGTools 设计文档

## 目标

TinyPNGTools 是一个零依赖的 Node.js 命令行图片压缩工具。用户在 Windows cmd 中运行工具后，工具会递归读取工具目录下 `SRC_PNG` 中的图片，通过 Tinify/TinyPNG HTTP API 上传压缩，并把压缩后的文件下载到 `OUT_PNG`。输出文件路径和文件名必须与 `SRC_PNG` 中的相对路径保持一致。

项目使用纯 JavaScript 实现，README 使用中文。工具默认处理 `.png`、`.jpg`、`.jpeg`、`.webp` 文件。

## 运行方式

正式运行使用工具所在目录作为工作根目录：

```cmd
node TinyPNGTools.js
```

工具启动时自动确保以下正式目录存在：

```text
SRC_PNG
OUT_PNG
RETRY_PNG
FAIL_PNG
```

自动测试与正式运行环境分开，测试固定使用 `TEST` 作为工作根目录，只操作以下目录：

```text
TEST/SRC_PNG
TEST/OUT_PNG
TEST/RETRY_PNG
TEST/FAIL_PNG
```

测试不会读取、写入或删除正式运行目录中的图片。

## 配置

配置文件为工具目录下的 `config.json`：

```json
{
  "apiKey": "TinyPNG_API_KEY",
  "concurrency": 5,
  "extensions": [".png", ".jpg", ".jpeg", ".webp"],
  "maxRetries": 3
}
```

配置校验规则：

- `apiKey` 必须是非空字符串。
- `concurrency` 必须是正整数，默认值为 `5`。
- `extensions` 必须是非空字符串数组，默认值为 `.png`、`.jpg`、`.jpeg`、`.webp`。
- `maxRetries` 必须是非负整数，默认值为 `3`。

真实密钥不应写入 README 示例。README 只提供占位示例。

## Tinify HTTP API

工具使用 Tinify 官方 HTTP API：

- 上传地址：`POST https://api.tinify.com/shrink`
- 请求体：原始图片二进制内容
- 认证：HTTP Basic Auth，用户名为 `api`，密码为 `config.json` 中的 `apiKey`
- 成功响应：读取响应头 `Location`，再向该地址发起下载请求，保存压缩后的图片

参考文档：https://tinify.com/developers/reference/http

## 核心流程

启动流程：

1. 读取并校验 `config.json`。
2. 创建正式运行目录或测试目录。
3. 检查当前工作根目录下的 `RETRY_PNG` 是否有待重试文件。
4. 根据 `RETRY_PNG` 状态进入重试流程或正常压缩流程。

如果 `RETRY_PNG` 有文件，工具在 cmd 中询问用户是否重试：

- 选择重试：先处理 `RETRY_PNG` 中的文件。全部重试成功后，比较 `SRC_PNG` 和 `OUT_PNG`，继续压缩 `SRC_PNG` 中尚未输出到 `OUT_PNG` 的文件。
- 选择不重试：清空 `RETRY_PNG` 和 `OUT_PNG`，再从 `SRC_PNG` 重新执行完整压缩流程。

正常压缩流程：

1. 递归扫描 `SRC_PNG` 下符合扩展名规则的图片。
2. 对每个源文件计算相对路径。
3. 如果 `OUT_PNG` 已存在同相对路径文件，则跳过该文件，用作断点续处理。
4. 以 `concurrency` 控制并发数量，默认同时处理 `5` 个文件。
5. 上传图片到 Tinify，拿到 `Location` 后下载压缩文件。
6. 将压缩文件写入 `OUT_PNG` 的同相对路径。

## 断点续处理

TinyPNGTools 的断点续传定义为断点续处理，而不是 HTTP 分片续传。工具重启后：

- 已经存在于 `OUT_PNG` 且路径匹配的文件视为已完成，直接跳过。
- `RETRY_PNG` 中遗留的文件视为未完成失败项，启动时优先询问是否重试。
- `SRC_PNG` 有而 `OUT_PNG` 没有的文件视为未完成文件，会继续压缩。

## 失败处理

单文件压缩失败不会中断整批任务。

首次压缩失败时：

1. 将 `SRC_PNG` 中失败的源文件复制到 `RETRY_PNG` 的同相对路径。
2. 进入自动重试队列。

自动重试规则：

- 对 `RETRY_PNG` 中的文件最多重试 `3` 次。
- 重试成功后，将压缩结果写入 `OUT_PNG` 的同相对路径，并删除 `RETRY_PNG` 中对应文件。
- 重试 `3` 次后仍失败，将 `SRC_PNG` 中的原始文件复制到 `FAIL_PNG` 的同相对路径，并删除 `RETRY_PNG` 中对应文件。

如果失败文件只存在于 `RETRY_PNG`，但 `SRC_PNG` 中已没有对应源文件，工具应把 `RETRY_PNG` 中的文件复制到 `FAIL_PNG`，避免丢失失败样本。

## 进度与结果输出

运行中输出：

- 当前文件的上传状态。
- 当前文件的下载状态。
- 当前总完成数量。
- 当前成功数量。
- 当前失败数量。

所有流程完成后输出汇总：

```text
总共处理图片: <数量>
成功压缩图片: <数量>
失败图片: <数量>
TinyPNG_ALL_COMPLETED
```

`TinyPNG_ALL_COMPLETED` 必须作为所有流程结束后的最终完成标记之一输出，便于其他脚本识别。

## 错误处理

配置错误：

- `config.json` 不存在、JSON 无法解析、`apiKey` 为空、`concurrency` 非法等情况，工具打印中文错误并退出。
- 配置错误不会创建或修改图片输出目录。

不可恢复错误：

- 无法创建工作目录。
- 无法读取 `SRC_PNG`。
- 无法写入 `OUT_PNG`、`RETRY_PNG` 或 `FAIL_PNG`。

这些错误会终止本次运行，因为继续执行会造成结果不可信。

单文件错误：

- Tinify 返回错误状态码。
- 网络失败。
- 下载失败。
- 单文件读写失败。

这些错误只影响当前文件，文件会进入重试和失败目录流程。

## 测试设计

自动测试使用 Node.js 内置能力实现，不依赖第三方测试框架。测试入口可以放在 `TEST/run-tests.js`，以 `TEST` 为工作根目录。

测试覆盖：

- 配置校验。
- 图片扩展名筛选。
- `SRC_PNG` 到 `OUT_PNG` 的相对路径映射。
- `OUT_PNG` 已有文件时的断点续处理跳过逻辑。
- 失败文件复制到 `RETRY_PNG`。
- 重试成功后写入 `OUT_PNG` 并删除 `RETRY_PNG`。
- 重试失败后复制到 `FAIL_PNG` 并删除 `RETRY_PNG`。
- 测试只操作 `TEST/SRC_PNG`、`TEST/OUT_PNG`、`TEST/RETRY_PNG`、`TEST/FAIL_PNG`。

## 文件结构

预期实现后的主要文件：

```text
TinyPNGTools.js
config.example.json
README.md
TEST/run-tests.js
docs/superpowers/specs/2026-06-30-tinypngtools-design.md
```

`config.json` 用于本地真实运行，包含用户 API Key，不应提交真实密钥。可以提交 `config.example.json` 作为示例。
