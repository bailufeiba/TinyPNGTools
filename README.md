# TinyPNGTools 

 TinyPNGTools 是一个用 TinyPNG/Tinify HTTP API 批量压缩图片的 Node.js 命令行工具。
 
 TinyPNGTools 基于SuperPowers+DeepSeek v4 pro实现,烧了大概3000万token

### 普通模式:
    node TinyPNGTools.js
- 工具会读取当前工具目录下 SRC_PNG 中的图片，上传到 TinyPNG 服务器压缩，再把结果下载到 OUT_PNG。
- 输出文件的相对路径和文件名会与 SRC_PNG 保持一致。
- 成功后会更新SRC_PNG.json


 ### source模式:
    node TinyPNGTools.js --source D:\my-images --ignore D:\my-images\ignore.json
- 指向一个外部图片目录，工具自动检测新增和修改的文件，压缩后回写。
- 工具会生成 todo.json 记录源目录文件信息，与 SRC_PNG.json 比较差异。只有新增或 MD5 变化的文件才会进入压缩流程。压缩完成后，结果自动复制回源目录，并删除 todo.json。
- 该模式只处理 todo.json 与 SRC_PNG.json 对比后得到的差异文件。
- "D:\my-images\ignore.json"里指定的被忽略的文件不会进入压缩流程。
 
### 命令支持
- node TinyPNGTools.js
- node TinyPNGTools.js --source <dir> [--ignore <path>]
- node TinyPNGTools.js clear
- node TinyPNGTools.js --help
- node TinyPNGTools.js -h

 TinyPng地址 https://tinypng.com/
 
 TinyPng API申请 https://tinify.com/developers
 
 TinyPng API文档 https://tinify.com/developers/reference/http

## 功能

- 支持 .png、.jpg、.jpeg、.webp
- 支持递归扫描子目录
- 支持批量并发压缩，默认并发 5
- 支持断点续处理：OUT_PNG 已存在的同路径文件会跳过
- 支持失败文件进入 RETRY_PNG
- 支持自动重试，默认重试 3 次
- 重试失败后进入 FAIL_PNG
- 支持 --source 指向外部源目录，按差异同步压缩
- 支持 --ignore 排除指定文件
- 自动测试固定运行在 TEST 目录，不影响真实图片目录

## 目录结构

正式运行目录：

    SRC_PNG
    OUT_PNG
    RETRY_PNG
    FAIL_PNG

自动测试目录：

    TEST/SRC_PNG
    TEST/OUT_PNG
    TEST/RETRY_PNG
    TEST/FAIL_PNG

## 配置

API KEY 申请地址 https://tinify.com/developers

复制 config.example.json 为 config.json，然后填写自己的 TinyPNG API Key。

    {
      "apiKey": "TinyPNG_API_KEY",
      "concurrency": 5,
      "extensions": [".png", ".jpg", ".jpeg", ".webp"],
      "maxRetries": 3
    }

## 运行

### 基础模式

把需要压缩的图片放入 SRC_PNG，然后运行:

    node TinyPNGTools.js

所有流程完成后会输出 TinyPNG_ALL_COMPLETED。

### 源目录同步模式

指向一个外部图片目录，工具自动检测新增和修改的文件，压缩后回写。

    node TinyPNGTools.js --source D:\my-images

工具会生成 todo.json 记录源目录文件信息，与 SRC_PNG.json 比较差异。只有新增或 MD5 变化的文件才会进入压缩流程。压缩完成后，结果自动复制回源目录，并删除 todo.json。

--source 模式启动时会直接清空 RETRY_PNG，不再询问是否重试，也不会处理 RETRY_PNG 中遗留的文件。该模式只处理 todo.json 与 SRC_PNG.json 对比后得到的差异文件。

### 忽略文件

在同步模式下，可以指定一个忽略 JSON 排除某些文件。

    node TinyPNGTools.js --source D:\my-images --ignore D:\my-images\ignore.json

ignore.json 格式：

    {
      "ignore": [
        "nested/photo.png"
      ]
    }

路径相对于源目录。被忽略的文件不会进入压缩流程。

## 未完成任务处理

### 基础模式

不使用 --source 时，如果启动时检测到 RETRY_PNG 中有文件，工具会询问是否重试。

选择重试时：先压缩 RETRY_PNG 中的文件，重试成功后写入 OUT_PNG 并删除，然后继续处理 SRC_PNG 中尚未输出的文件。

选择不重试时：只清空 RETRY_PNG，保留 OUT_PNG，然后继续处理 SRC_PNG 中尚未输出到 OUT_PNG 的文件。

### --source 模式

使用 --source 时，工具不会检测 RETRY_PNG 是否有文件，也不会询问是否重试。启动后会直接清空 RETRY_PNG，然后按源目录生成 todo.json，与 SRC_PNG.json 比较差异，只压缩差异文件。

## 自动测试

    node TEST\run-tests.js

自动测试只操作 TEST 目录下的四个图片目录，不会处理真实运行目录中的图片。

## TinyPNG API 文档

https://tinify.com/developers/reference/http

## clear 命令

清空缓存并强制后续重新压缩全部 PNG：

    node TinyPNGTools.js clear

执行后工具会先提示：

    是否清空所有缓存？该行为会导致后续所有PNG重新压缩 (y/n):

只有输入 `y` 或 `yes` 才会继续执行。确认后会：

- 清空并重建 `SRC_PNG`
- 清空并重建 `OUT_PNG`
- 清空并重建 `RETRY_PNG`
- 清空并重建 `FAIL_PNG`
- 删除 `todo.json`
- 将 `SRC_PNG.json` 重置为：

    {
      "files": []
    }

输入其他内容会取消操作，不会清空缓存。

## help 命令

查看当前支持的命令和参数：

    node TinyPNGTools.js --help

也可以使用短参数：

    node TinyPNGTools.js -h

该命令只打印帮助信息，不会读取 `config.json`，也不会执行压缩或清理操作。

## SRC_PNG.json

`SRC_PNG.json` 用来记录已经处理过的文件内容哈希。每个文件记录两个 MD5 值：

    {
      "files": [
        {
          "path": "GameFramework\\Res\\FairyGui\\ResCommon_atlas0.png",
          "src_md5": "压缩前文件内容MD5",
          "out_md5": "压缩后文件内容MD5"
        }
      ]
    }

判断是否需要压缩时，工具会把当前文件内容 MD5 与 `src_md5`、`out_md5` 任意一个值比较。

在 `--source` 模式下，如果当前文件内容 MD5 命中 `src_md5` 或 `out_md5`，并且 `OUT_PNG` 中存在同相对路径文件，工具会跳过 Tinify 压缩流程：先把源目录文件复制到工作目录 `SRC_PNG`，再把 `OUT_PNG` 中的缓存文件复制回外部源目录。

如果 MD5 命中但 `OUT_PNG` 中没有同相对路径文件，该文件仍会进入压缩流程。

文件压缩完成后，工具会将压缩前内容 MD5 写入 `src_md5`，将压缩后内容 MD5 写入 `out_md5`。
