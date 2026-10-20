// VerifyTinifyKeys - 批量校验 Tinify/TinyPNG API Key 是否有效
// 用法: node VerifyTinifyKeys.js [keyFile] [--concurrency N]
//
// 校验原理:
//   向 https://api.tinify.com/shrink 发送一个「空请求体」的 POST 请求。
//   Tinify 会在压缩之前就拒绝该请求，因此不会消耗任何压缩次数（额度）:
//     400 InputMissing      -> Key 有效（只是没有上传图片）
//     401 Unauthorized      -> Key 无效
//     402 PaymentRequired   -> Key 有效，但当月免费额度已用尽
//     429 TooManyRequests   -> 被限流，需退避后重试
//   兜底: 对任何异常（网络错误/429/5xx）都会按指数退避重试多次。

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_HOST = 'api.tinify.com';
const API_PATH = '/shrink';
const KEY_PATTERN = /^[A-Za-z0-9]{32}$/; // TinyPNG 的 Key 固定为 32 位字母数字
const DEFAULT_CONCURRENCY = 3;
const MAX_ATTEMPTS = 5;

// 单次请求超时时间（毫秒）
const REQUEST_TIMEOUT = 20000;

// 发送一次鉴权请求，返回 { statusCode, body }；网络错误时 reject
function requestOnce(apiKey) {
  return new Promise((resolve, reject) => {
    const authorization = `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`;
    const req = https.request(
      {
        method: 'POST',
        hostname: API_HOST,
        path: API_PATH,
        headers: {
          Authorization: authorization,
          'Content-Length': 0,
        },
        timeout: REQUEST_TIMEOUT,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );

    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

// 根据 HTTP 状态码与响应体判定 Key 状态
function classify(statusCode, body) {
  switch (statusCode) {
    case 400:
      return { state: 'valid', message: 'Key 有效（额度可用）' };
    case 401:
      return { state: 'invalid', message: 'Key 无效（Credentials are invalid）' };
    case 402:
      return { state: 'valid_no_quota', message: 'Key 有效，但本月额度已用尽' };
    case 403:
      return { state: 'invalid', message: 'Key 被禁用或无权限' };
    case 429:
      return { state: 'rate_limited', message: '触发限流（429）' };
    default: {
      if (statusCode >= 200 && statusCode < 300) {
        // 理论上不会走到这里（空请求体不会被成功压缩）
        return { state: 'valid', message: 'Key 有效' };
      }
      const hint = body ? body.slice(0, 120) : '';
      return { state: 'unknown', message: `未知响应 ${statusCode}${hint ? `: ${hint}` : ''}` };
    }
  }
}

// 带退避重试地校验单个 Key
async function verifyKey(apiKey) {
  let lastMessage = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let result;
    try {
      const response = await requestOnce(apiKey);
      result = classify(response.statusCode, response.body);
      result.statusCode = response.statusCode;
    } catch (error) {
      result = { state: 'retry', message: `网络错误: ${error.message}` };
    }

    if (result.state !== 'retry' && result.state !== 'rate_limited') {
      return result;
    }

    lastMessage = result.message;
    if (attempt < MAX_ATTEMPTS) {
      // 指数退避 + 抖动，避免并发重试同时打满限流
      const backoff = Math.min(8000, 800 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  return { state: 'unknown', message: `重试 ${MAX_ATTEMPTS} 次后仍失败: ${lastMessage}` };
}

// 解析 Key 文件：逐行去除空白，过滤非法行并单独记录
function parseKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const keys = [];
  const skipped = [];

  content.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    if (KEY_PATTERN.test(line)) {
      keys.push(line);
    } else {
      skipped.push({ line: index + 1, text: line });
    }
  });

  // 去重（保留首次出现顺序），重复项单独记录
  const seen = new Set();
  const unique = [];
  const duplicates = [];
  keys.forEach((key) => {
    if (seen.has(key)) {
      duplicates.push(key);
      return;
    }
    seen.add(key);
    unique.push(key);
  });

  return { keys: unique, skipped, duplicates };
}

// 以固定并发度跑完所有任务，结果保持输入顺序
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
  return results;
}

function parseArgs(argv) {
  const options = { keyFile: path.join(__dirname, 'TinifyKey.txt'), concurrency: DEFAULT_CONCURRENCY };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--concurrency' || arg === '-c') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--concurrency 需要大于等于 1 的整数');
      }
      options.concurrency = value;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!arg.startsWith('-')) {
      options.keyFile = path.resolve(arg);
    }
  }
  return options;
}

function printHelp() {
  console.log(
    [
      'VerifyTinifyKeys - 校验 Tinify API Key 有效性',
      '',
      'Usage:',
      '  node VerifyTinifyKeys.js [keyFile] [--concurrency N]',
      '',
      'Options:',
      '  keyFile            Key 列表文件，默认 TinifyKey.txt（每行一个 Key）',
      '  --concurrency, -c  并发数，默认 3',
      '  --help, -h         显示帮助',
      '',
      'Output:',
      '  TinifyKeyResult.json  校验明细；有效 Key 会同时写回 stdout',
    ].join('\n')
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(options.keyFile)) {
    throw new Error(`未找到 Key 文件: ${options.keyFile}`);
  }

  const { keys, skipped, duplicates } = parseKeys(options.keyFile);
  if (keys.length === 0) {
    throw new Error(`${options.keyFile} 中没有找到合法的 Key（需 32 位字母数字）`);
  }

  console.log(`共解析到 ${keys.length} 个 Key（并发 ${options.concurrency}），开始校验...`);
  if (skipped.length > 0) {
    console.log(`已忽略 ${skipped.length} 行非 Key 内容:`);
    skipped.forEach((item) => console.log(`  第 ${item.line} 行: ${item.text}`));
  }
  if (duplicates.length > 0) {
    console.log(`发现 ${duplicates.length} 个重复 Key，已去重。`);
  }

  const startedAt = Date.now();
  let done = 0;
  const records = await mapWithConcurrency(keys, options.concurrency, async (key) => {
    const result = await verifyKey(key);
    done += 1;
    process.stdout.write(`\r校验进度: ${done}/${keys.length}`);
    return { key, ...result };
  });
  process.stdout.write('\n');

  const valid = records.filter((r) => r.state === 'valid');
  const noQuota = records.filter((r) => r.state === 'valid_no_quota');
  const invalid = records.filter((r) => r.state === 'invalid');
  const unknown = records.filter((r) => r.state === 'unknown');

  const outputPath = path.join(__dirname, 'TinifyKeyResult.json');
  const report = {
    checkedAt: new Date().toISOString(),
    keyFile: options.keyFile,
    total: records.length,
    summary: {
      valid: valid.length,
      validNoQuota: noQuota.length,
      invalid: invalid.length,
      unknown: unknown.length,
    },
    skippedLines: skipped,
    duplicateKeys: duplicates,
    valid: valid.map((r) => r.key),
    validNoQuota: noQuota.map((r) => r.key),
    invalid: invalid.map((r) => r.key),
    unknown: unknown.map((r) => ({ key: r.key, message: r.message })),
    records,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('');
  console.log('='.repeat(56));
  console.log(`校验完成，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`  有效 Key        : ${valid.length}`);
  console.log(`  有效但额度已用尽: ${noQuota.length}`);
  console.log(`  无效 Key        : ${invalid.length}`);
  console.log(`  未知/异常       : ${unknown.length}`);
  console.log('='.repeat(56));

  if (valid.length > 0) {
    console.log('');
    console.log(`【有效 Key】共 ${valid.length} 个:`);
    valid.forEach((r, index) => console.log(`  ${String(index + 1).padStart(3, ' ')}. ${r.key}`));
  }

  if (noQuota.length > 0) {
    console.log('');
    console.log(`【有效但额度已用尽】共 ${noQuota.length} 个:`);
    noQuota.forEach((r, index) => console.log(`  ${String(index + 1).padStart(3, ' ')}. ${r.key}`));
  }

  if (unknown.length > 0) {
    console.log('');
    console.log(`【未知/异常】共 ${unknown.length} 个:`);
    unknown.forEach((r) => console.log(`  ${r.key} - ${r.message}`));
  }

  console.log('');
  console.log(`明细已写入: ${outputPath}`);
}

main().catch((error) => {
  console.error(`校验失败: ${error.message}`);
  process.exitCode = 1;
});
