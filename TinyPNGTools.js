// TinyPNGTools - 基于 TinyPNG/Tinify HTTP API 的图片批量压缩命令行工具
// 用法: node TinyPNGTools.js [--source <dir>] [--ignore <path>]

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const crypto = require('crypto');

// 工作目录名常量，所有读写操作限定在这些目录内
const WORK_DIRS = {
  src: 'SRC_PNG',
  out: 'OUT_PNG',
  retry: 'RETRY_PNG',
  fail: 'FAIL_PNG',
};

// 默认配置，冻结防止外部修改
const DEFAULT_CONFIG = Object.freeze({
  concurrency: 5,
  extensions: Object.freeze(['.png', '.jpg', '.jpeg', '.webp']),
  maxRetries: 3,
});

// 读取并校验配置对象，填充默认值，对扩展名做规范化处理
function normalizeConfig(config = {}) {
  const input = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const concurrency = input.concurrency === undefined ? DEFAULT_CONFIG.concurrency : input.concurrency;
  const extensions = input.extensions === undefined ? DEFAULT_CONFIG.extensions : input.extensions;
  const maxRetries = input.maxRetries === undefined ? DEFAULT_CONFIG.maxRetries : input.maxRetries;

  if (!apiKey) {
    throw new Error('apiKey must be a non-empty string');
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be an integer greater than or equal to 1');
  }

  if (!Array.isArray(extensions) || extensions.length === 0) {
    throw new Error('extensions must be a non-empty array');
  }

  const normalizedExtensions = extensions.map((extension) => {
    if (typeof extension !== 'string' || !extension.trim()) {
      throw new Error('extensions must contain non-empty strings');
    }

    const normalized = extension.trim().toLowerCase();
    return normalized.startsWith('.') ? normalized : `.${normalized}`;
  });

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error('maxRetries must be an integer greater than or equal to 0');
  }

  return {
    apiKey,
    concurrency,
    extensions: normalizedExtensions,
    maxRetries,
  };
}

// 从 baseDir 下的 config.json 读取并校验配置
function loadConfig(baseDir) {
  const configPath = path.join(baseDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('未找到 config.json，请先创建配置文件。');
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`config.json 解析失败: ${error.message}`);
  }
  return normalizeConfig(raw);
}

// 在命令行中向用户提出 Y/N 问题并等待回答
function askYesNo(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      const value = answer.trim().toLowerCase();
      resolve(value === 'y' || value === 'yes');
    });
  });
}

// 格式化最终汇总输出，末尾包含 TinyPNG_ALL_COMPLETED 标记
function formatSummary(summary) {
  return [
    `总共处理图片: ${summary.total}`,
    `成功压缩图片: ${summary.success}`,
    `失败图片: ${summary.failed}`,
    'TinyPNG_ALL_COMPLETED',
  ].join('\n');
}

function formatHelp() {
  return [
    'TinyPNGTools',
    '',
    'Usage:',
    '  node TinyPNGTools.js',
    '  node TinyPNGTools.js --source <dir> [--ignore <path>]',
    '  node TinyPNGTools.js clear',
    '  node TinyPNGTools.js --help',
    '',
    'Commands:',
    '  default                 Compress pending images from SRC_PNG to OUT_PNG.',
    '  --source <dir>          Sync changed files from an external source directory.',
    '  --ignore <path>         Ignore paths listed in a JSON file when using --source.',
    '  clear                   Clear SRC_PNG, OUT_PNG, RETRY_PNG, FAIL_PNG, delete todo.json, reset SRC_PNG.json.',
    '  --help, -h              Show this help.',
  ].join('\n');
}


// 确保四个工作目录存在
function ensureWorkDirs(baseDir) {
  for (const folderName of Object.values(WORK_DIRS)) {
    fs.mkdirSync(path.join(baseDir, folderName), { recursive: true });
  }
}

// 递归扫描指定根目录下所有匹配扩展名的图片文件，返回排序后的完整路径列表
function scanImages(rootDir, extensions) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const supportedExtensions = new Set(extensions.map((extension) => extension.toLowerCase()));
  const files = [];

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      }
    }
  }

  walk(rootDir);
  return files.sort();
}

function assertInsidePath(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (relativePath && (relativePath.startsWith('..') || path.isAbsolute(relativePath))) {
    throw new Error(`path is outside work directory: ${candidatePath}`);
  }
}

// 获取文件相对于某个工作目录的相对路径，带越界保护
function getRelativePath(baseDir, folderName, filePath) {
  const rootPath = path.resolve(baseDir, folderName);
  const candidatePath = path.resolve(filePath);
  assertInsidePath(rootPath, candidatePath);
  return path.relative(rootPath, candidatePath);
}

// 将相对路径映射到某个工作目录下的完整输出路径，带越界保护
function getOutputPath(baseDir, folderName, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`path is outside work directory: ${relativePath}`);
  }

  const rootPath = path.resolve(baseDir, folderName);
  const candidatePath = path.resolve(rootPath, relativePath);
  assertInsidePath(rootPath, candidatePath);
  return candidatePath;
}

// 从 SRC_PNG 中收集尚未输出到 OUT_PNG 的待处理源文件
function collectPendingSourceFiles(baseDir, extensions) {
  const sourceRoot = path.join(baseDir, WORK_DIRS.src);
  return scanImages(sourceRoot, extensions).filter((filePath) => {
    const relativePath = getRelativePath(baseDir, WORK_DIRS.src, filePath);
    const outputPath = getOutputPath(baseDir, WORK_DIRS.out, relativePath);
    return !(fs.existsSync(outputPath) && fs.statSync(outputPath).isFile());
  });
}

// 确保文件的父目录存在，用于在写文件前创建目录结构
function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// 从指定目录向上清理空目录，直到 stopDir 或遇到非空目录为止
function removeEmptyParents(startDir, stopDir) {
  let current = startDir;
  while (current !== stopDir) {
    const rel = path.relative(stopDir, current);
    if (rel.startsWith('..') || path.isAbsolute(rel)) break;
    if (!fs.existsSync(current)) {
      current = path.dirname(current);
      continue;
    }
    if (fs.readdirSync(current).length > 0) {
      break;
    }
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

// 将失败的源文件复制到 RETRY_PNG，保留子目录结构
function copyToRetry(baseDir, sourceFile) {
  const relativePath = getRelativePath(baseDir, WORK_DIRS.src, sourceFile);
  const retryFile = getOutputPath(baseDir, WORK_DIRS.retry, relativePath);
  ensureParentDir(retryFile);
  fs.copyFileSync(sourceFile, retryFile);
  return retryFile;
}

// 重试成功后：将压缩结果写入 OUT_PNG，删除 RETRY_PNG 中的文件，清理空目录
function moveRetrySuccess(baseDir, retryFile, outputBuffer) {
  const relativePath = getRelativePath(baseDir, WORK_DIRS.retry, retryFile);
  const outputPath = getOutputPath(baseDir, WORK_DIRS.out, relativePath);
  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, outputBuffer);
  fs.rmSync(retryFile, { force: true });
  removeEmptyParents(path.dirname(retryFile), path.join(baseDir, WORK_DIRS.retry));
  return outputPath;
}

// 重试最终失败：将源文件（或 RETRY_PNG 中的文件）复制到 FAIL_PNG，删除 RETRY_PNG 条目
function moveRetryFailure(baseDir, retryFile) {
  const relativePath = getRelativePath(baseDir, WORK_DIRS.retry, retryFile);
  const sourceFile = getOutputPath(baseDir, WORK_DIRS.src, relativePath);
  const failFile = getOutputPath(baseDir, WORK_DIRS.fail, relativePath);
  ensureParentDir(failFile);
  if (fs.existsSync(sourceFile)) {
    fs.copyFileSync(sourceFile, failFile);
  } else {
    fs.copyFileSync(retryFile, failFile);
  }
  fs.rmSync(retryFile, { force: true });
  removeEmptyParents(path.dirname(retryFile), path.join(baseDir, WORK_DIRS.retry));
  return failFile;
}

// 带并发限制的异步队列，保证结果按输入顺序排列
async function runQueue(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  const workers = [];
  for (let index = 0; index < workerCount; index += 1) {
    workers.push(runWorker());
  }

  await Promise.all(workers);
  return results;
}

// 递归扫描目录生成文件清单，包含相对路径和文件内容的 MD5 哈希
function generateFileList(dirPath, extensions) {
  const files = scanImages(dirPath, extensions);
  return {
    files: files.map(fullPath => {
      const relative = path.relative(dirPath, fullPath);
      const content = fs.readFileSync(fullPath);
      const md5 = crypto.createHash('md5').update(content).digest('hex');
      return { path: relative, md5 };
    })
  };
}

function entryMatchesMd5(entry, md5) {
  if (!entry || !md5) {
    return false;
  }
  return entry.md5 === md5 || entry.md52 === md5;
}

// 安全读取 SRC_PNG.json，文件不存在或格式损坏时返回空列表
function readSrcPngJson(baseDir) {
  const filePath = path.join(baseDir, 'SRC_PNG.json');
  if (!fs.existsSync(filePath)) {
    return { files: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data || !Array.isArray(data.files)) {
      return { files: [] };
    }
    return data;
  } catch (e) {
    return { files: [] };
  }
}

// 从 JSON 文件加载忽略路径列表，返回 Set<string>
function loadIgnoreList(ignorePath) {
  if (!fs.existsSync(ignorePath)) {
    return new Set();
  }
  try {
    const data = JSON.parse(fs.readFileSync(ignorePath, 'utf8'));
    if (!data || !Array.isArray(data.ignore)) {
      return new Set();
    }
    return new Set(data.ignore);
  } catch (e) {
    return new Set();
  }
}

// --source 同步模式：对比源目录与 SRC_PNG.json 的差异，复制变化文件，清理过期输出
function syncSourceToWorkDirs(baseDir, sourceDir, extensions, ignoreSet) {
  const todo = generateFileList(sourceDir, extensions);
  fs.writeFileSync(path.join(baseDir, 'todo.json'), JSON.stringify(todo, null, 2), 'utf8');

  const srcPng = readSrcPngJson(baseDir);
  const srcPngMap = new Map(srcPng.files.map(f => [f.path, f]));

  const changedFiles = [];

  for (const entry of todo.files) {
    const srcPngEntry = srcPngMap.get(entry.path);
    if (!entryMatchesMd5(srcPngEntry, entry.md5)) {
      if (ignoreSet && ignoreSet.has(entry.path)) {
        const outFile = path.join(baseDir, WORK_DIRS.out, entry.path);
        if (fs.existsSync(outFile)) {
          fs.rmSync(outFile, { force: true });
        }
        continue;
      }
      const srcFile = path.join(sourceDir, entry.path);
      const dstFile = path.join(baseDir, WORK_DIRS.src, entry.path);
      ensureParentDir(dstFile);
      fs.copyFileSync(srcFile, dstFile);

      const outFile = path.join(baseDir, WORK_DIRS.out, entry.path);
      if (fs.existsSync(outFile)) {
        fs.rmSync(outFile, { force: true });
      }

      changedFiles.push(entry.path);
    }
  }

  return { changedFiles };
}

// 更新 SRC_PNG.json 中指定路径文件的 MD5 记录（新增或覆盖）
function updateSrcPngJson(baseDir, relativePath, md5, md52) {
  const data = readSrcPngJson(baseDir);
  const existing = data.files.findIndex(f => f.path === relativePath);
  if (existing >= 0) {
    data.files[existing].md5 = md5;
    data.files[existing].md52 = md52;
  } else {
    data.files.push({ path: relativePath, md5, md52 });
  }
  fs.writeFileSync(path.join(baseDir, 'SRC_PNG.json'), JSON.stringify(data, null, 2), 'utf8');
}

// 将 OUT_PNG 中的压缩结果复制回源目录
function copyOutputsToSource(baseDir, sourceDir, changedFiles) {
  for (const relativePath of changedFiles) {
    const outFile = path.join(baseDir, WORK_DIRS.out, relativePath);
    if (fs.existsSync(outFile)) {
      const dstFile = path.join(sourceDir, relativePath);
      ensureParentDir(dstFile);
      fs.copyFileSync(outFile, dstFile);
    }
  }
}


// 从 Tinify API 返回的 JSON 错误体中提取可读的错误信息
function parseJsonMessage(buffer) {
  try {
    const data = JSON.parse(buffer.toString('utf8'));
    return data.message || data.error || buffer.toString('utf8');
  } catch (error) {
    return buffer.toString('utf8');
  }
}

// 封装 Node.js https.request 为 Promise，返回 { statusCode, headers, body }
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// 创建 Tinify HTTP 客户端：提供 compress 方法执行上传/下载流程
function createTinifyClient(apiKey, request = httpsRequest) {
  const authorization = `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`;

  async function compress(inputBuffer) {
    const uploadResponse = await request(
      {
        method: 'POST',
        hostname: 'api.tinify.com',
        path: '/shrink',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/octet-stream',
          'Content-Length': inputBuffer.length,
        },
      },
      inputBuffer
    );

    if (uploadResponse.statusCode < 200 || uploadResponse.statusCode >= 300) {
      throw new Error(`Tinify 上传失败 ${uploadResponse.statusCode}: ${parseJsonMessage(uploadResponse.body)}`);
    }

    const location = uploadResponse.headers.location;
    if (!location) {
      throw new Error('Tinify 上传成功但响应中没有 Location。');
    }

    const url = new URL(location);
    const downloadResponse = await request({
      method: 'GET',
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers: {
        Authorization: authorization,
      },
    });

    if (downloadResponse.statusCode < 200 || downloadResponse.statusCode >= 300) {
      throw new Error(`Tinify 下载失败 ${downloadResponse.statusCode}: ${parseJsonMessage(downloadResponse.body)}`);
    }

    return downloadResponse.body;
  }

  return { compress };
}

// CLI 入口：解析参数，加载配置，执行压缩或同步模式
async function main() {
  const baseDir = __dirname;

  if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log(formatHelp());
    return;
  }

  if (process.argv[2] === 'clear') {
    const confirmed = await askYesNo('是否清空所有缓存？该行为会导致后续所有PNG重新压缩');
    if (!confirmed) {
      console.log('已取消清空缓存。');
      return;
    }
    clearCache(baseDir);
    console.log('缓存已清空。');
    return;
  }

  const config = loadConfig(baseDir);

  let sourceDir = null;
  let ignorePath = null;
  let changedFiles = [];

  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--source' && i + 1 < process.argv.length) {
      sourceDir = path.resolve(process.argv[i + 1]);
      i += 1;
    }
    if (process.argv[i] === '--ignore' && i + 1 < process.argv.length) {
      ignorePath = path.resolve(process.argv[i + 1]);
      i += 1;
    }
  }

  if (sourceDir) {
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`源目录不存在: ${sourceDir}`);
    }
    if (!fs.statSync(sourceDir).isDirectory()) {
      throw new Error(`--source 必须是目录: ${sourceDir}`);
    }

    const ignoreSet = ignorePath ? loadIgnoreList(ignorePath) : new Set();
    const syncResult = syncSourceToWorkDirs(baseDir, sourceDir, config.extensions, ignoreSet);
    changedFiles = syncResult.changedFiles;

    if (changedFiles.length === 0) {
      console.log('没有需要更新的文件。');
      const todoPath = path.join(baseDir, 'todo.json');
      if (fs.existsSync(todoPath)) {
        fs.rmSync(todoPath, { force: true });
      }
      return;
    }
  }

  // --source 模式下仅压缩差异文件，转换为绝对路径传给 runCompressionFlow
  const sourceFileList = sourceDir && changedFiles.length > 0
    ? changedFiles.map(f => path.join(baseDir, WORK_DIRS.src, f))
    : undefined;

  const client = createTinifyClient(config.apiKey);
  const summary = await runCompressionFlow({
    baseDir,
    config,
    client,
    logger: console,
    promptRetry: () => askYesNo('检测到 RETRY_PNG 中有未完成文件，是否重试'),
    sourceFiles: sourceFileList,
    skipRetryCheck: Boolean(sourceDir),
  });

  if (sourceDir) {
    copyOutputsToSource(baseDir, sourceDir, changedFiles);
    const todoPath = path.join(baseDir, 'todo.json');
    if (fs.existsSync(todoPath)) {
      fs.rmSync(todoPath, { force: true });
    }
  }

  console.log(formatSummary(summary));
}


// 清空指定目录（删除后重建）
function clearDirectory(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function clearCache(baseDir) {
  for (const folderName of Object.values(WORK_DIRS)) {
    clearDirectory(path.join(baseDir, folderName));
  }

  const todoPath = path.join(baseDir, 'todo.json');
  if (fs.existsSync(todoPath)) {
    fs.rmSync(todoPath, { force: true });
  }

  fs.writeFileSync(path.join(baseDir, 'SRC_PNG.json'), JSON.stringify({ files: [] }, null, 2), 'utf8');
}

// 检查 RETRY_PNG 中是否有待重试的匹配文件
function hasRetryFiles(baseDir, extensions) {
  return scanImages(path.join(baseDir, WORK_DIRS.retry), extensions).length > 0;
}

// 压缩单个 SRC_PNG 源文件：读取 → 上传 → 下载 → 写入 OUT_PNG → 更新 SRC_PNG.json
async function compressSourceFile(baseDir, sourceFile, client, logger) {
  const relativePath = getRelativePath(baseDir, WORK_DIRS.src, sourceFile);
  logger.log(`上传: ${relativePath}`);
  const inputBuffer = fs.readFileSync(sourceFile);
  const outputBuffer = await client.compress(inputBuffer);
  const outputPath = getOutputPath(baseDir, WORK_DIRS.out, relativePath);
  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, outputBuffer);
  logger.log(`下载完成: ${relativePath}`);
  const srcMd5 = crypto.createHash('md5').update(inputBuffer).digest('hex');
  const outputMd5 = crypto.createHash('md5').update(outputBuffer).digest('hex');
  updateSrcPngJson(baseDir, relativePath, srcMd5, outputMd5);
  return outputPath;
}

// 压缩单个 RETRY_PNG 文件：读取 → 上传 → 下载 → 移动到 OUT_PNG
async function compressRetryFile(baseDir, retryFile, client, logger) {
  const relativePath = getRelativePath(baseDir, WORK_DIRS.retry, retryFile);
  logger.log(`重试上传: ${relativePath}`);
  const inputBuffer = fs.readFileSync(retryFile);
  const outputBuffer = await client.compress(inputBuffer);
  const outputPath = moveRetrySuccess(baseDir, retryFile, outputBuffer);
  logger.log(`重试成功: ${relativePath}`);
  return outputPath;
}

// 对 RETRY_PNG 中的文件执行最多 maxRetries 轮重试，最终失败的移入 FAIL_PNG
async function retryFailedFiles(baseDir, config, client, logger, summary) {
  for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
    const retryFiles = scanImages(path.join(baseDir, WORK_DIRS.retry), config.extensions);
    if (retryFiles.length === 0) {
      return;
    }

    logger.log(`开始第 ${attempt}/${config.maxRetries} 轮重试，文件数: ${retryFiles.length}`);
    await runQueue(retryFiles, config.concurrency, async (retryFile) => {
      try {
        await compressRetryFile(baseDir, retryFile, client, logger);
        summary.success += 1;
      } catch (error) {
        logger.error(`重试失败: ${getRelativePath(baseDir, WORK_DIRS.retry, retryFile)} - ${error.message}`);
      }
    });
  }

  const remainingRetryFiles = scanImages(path.join(baseDir, WORK_DIRS.retry), config.extensions);
  for (const retryFile of remainingRetryFiles) {
    moveRetryFailure(baseDir, retryFile);
    summary.failed += 1;
  }
}

// 压缩所有待处理的 SRC_PNG 源文件，失败文件移入 RETRY_PNG，最后触发重试流程
// sourceFiles 为可选参数：传入时直接使用给定文件列表，跳过 collectPendingSourceFiles 扫描
async function processSourceFiles(baseDir, config, client, logger, summary, sourceFiles) {
  const pending = sourceFiles || collectPendingSourceFiles(baseDir, config.extensions);
  summary.total += pending.length;

  await runQueue(pending, config.concurrency, async (sourceFile, index) => {
    const relativePath = getRelativePath(baseDir, WORK_DIRS.src, sourceFile);
    try {
      await compressSourceFile(baseDir, sourceFile, client, logger);
      summary.success += 1;
    } catch (error) {
      logger.error(`压缩失败: ${relativePath} - ${error.message}`);
      copyToRetry(baseDir, sourceFile);
    }
    logger.log(`完成进度: ${index + 1}/${pending.length}，成功: ${summary.success}，失败: ${summary.failed}`);
  });

  await retryFailedFiles(baseDir, config, client, logger, summary);
}

// 核心编排函数：处理重试提示 → 源文件压缩 → 失败重试 → 返回汇总结果
async function runCompressionFlow(options) {
  const { baseDir, config, client, logger, promptRetry, sourceFiles, skipRetryCheck } = options;
  const summary = { total: 0, success: 0, failed: 0 };

  ensureWorkDirs(baseDir);

  if (skipRetryCheck) {
    clearDirectory(path.join(baseDir, WORK_DIRS.retry));
  } else if (hasRetryFiles(baseDir, config.extensions)) {
    const shouldRetry = await promptRetry();
    if (shouldRetry) {
      const retryCount = scanImages(path.join(baseDir, WORK_DIRS.retry), config.extensions).length;
      summary.total += retryCount;
      await retryFailedFiles(baseDir, config, client, logger, summary);
    } else {
      clearDirectory(path.join(baseDir, WORK_DIRS.retry));
    }
  }

  await processSourceFiles(baseDir, config, client, logger, summary, sourceFiles);
  return summary;
}

module.exports = {
  WORK_DIRS,
  DEFAULT_CONFIG,
  normalizeConfig,
  ensureWorkDirs,
  scanImages,
  getRelativePath,
  getOutputPath,
  collectPendingSourceFiles,
  copyToRetry,
  moveRetrySuccess,
  moveRetryFailure,
  runQueue,
  createTinifyClient,
  main,
  loadConfig,
  askYesNo,
  formatSummary,
  formatHelp,
  removeEmptyParents,
  clearDirectory,
  clearCache,
  hasRetryFiles,
  compressSourceFile,
  compressRetryFile,
  retryFailedFiles,
  processSourceFiles,
  runCompressionFlow,
  generateFileList,
  syncSourceToWorkDirs,
  updateSrcPngJson,
  copyOutputsToSource,
  loadIgnoreList,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
