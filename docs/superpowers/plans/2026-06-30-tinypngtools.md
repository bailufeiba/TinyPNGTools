# TinyPNGTools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-dependency Node.js CLI named TinyPNGTools that compresses images from `SRC_PNG` through the Tinify HTTP API, writes matching outputs to `OUT_PNG`, supports retry/failure folders, and keeps automated tests isolated under `TEST`.

**Architecture:** Keep the production tool in one JavaScript entry file, `TinyPNGTools.js`, but organize it into small functions for config, directory scanning, path mapping, retry handling, Tinify HTTP, queue execution, and CLI orchestration. Export those functions for tests while running the CLI only when the file is executed directly.

**Tech Stack:** Node.js built-ins only: `fs`, `path`, `https`, `readline`, `assert`, and `child_process` for tests. No npm dependencies.

---

## File Structure

- Create: `TinyPNGTools.js`
  - Production CLI entry and all runtime functions.
  - Exports pure/testable helpers and orchestration functions.
- Create: `config.example.json`
  - Safe example config without a real API key.
- Replace: `README.md`
  - Chinese usage documentation.
- Create: `TEST/run-tests.js`
  - Zero-dependency automated test runner.
  - Tests only use `TEST/SRC_PNG`, `TEST/OUT_PNG`, `TEST/RETRY_PNG`, and `TEST/FAIL_PNG`.
- Keep: `docs/superpowers/specs/2026-06-30-tinypngtools-design.md`
  - Approved design source.
- Keep: `docs/superpowers/plans/2026-06-30-tinypngtools.md`
  - This implementation plan.

Git operations are intentionally omitted because the user will handle git manually.

---

### Task 1: Add Test Harness and Initial Module Shape

**Files:**
- Create: `TinyPNGTools.js`
- Create: `TEST/run-tests.js`

- [ ] **Step 1: Create the failing test harness**

Create `TEST/run-tests.js` with this content:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const tool = require('../TinyPNGTools');

const TEST_ROOT = __dirname;
const DIRS = ['SRC_PNG', 'OUT_PNG', 'RETRY_PNG', 'FAIL_PNG'];

function removeDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function resetTestDirs() {
  for (const name of DIRS) {
    removeDir(path.join(TEST_ROOT, name));
    fs.mkdirSync(path.join(TEST_ROOT, name), { recursive: true });
  }
}

function writeFile(relativePath, content) {
  const fullPath = path.join(TEST_ROOT, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function exists(relativePath) {
  return fs.existsSync(path.join(TEST_ROOT, relativePath));
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('exports required functions', () => {
  assert.strictEqual(typeof tool.normalizeConfig, 'function');
  assert.strictEqual(typeof tool.ensureWorkDirs, 'function');
  assert.strictEqual(typeof tool.scanImages, 'function');
  assert.strictEqual(typeof tool.getRelativePath, 'function');
  assert.strictEqual(typeof tool.getOutputPath, 'function');
  assert.strictEqual(typeof tool.collectPendingSourceFiles, 'function');
  assert.strictEqual(typeof tool.copyToRetry, 'function');
  assert.strictEqual(typeof tool.moveRetrySuccess, 'function');
  assert.strictEqual(typeof tool.moveRetryFailure, 'function');
  assert.strictEqual(typeof tool.runQueue, 'function');
  assert.strictEqual(typeof tool.createTinifyClient, 'function');
});

async function run() {
  let passed = 0;
  for (const item of tests) {
    resetTestDirs();
    await item.fn();
    passed += 1;
    console.log(`PASS ${item.name}`);
  }
  console.log(`All tests passed: ${passed}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```cmd
node TEST\run-tests.js
```

Expected: FAIL because `../TinyPNGTools` does not exist.

- [ ] **Step 3: Create the initial module with exported stubs**

Create `TinyPNGTools.js` with this content:

```js
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

const WORK_DIRS = {
  src: 'SRC_PNG',
  out: 'OUT_PNG',
  retry: 'RETRY_PNG',
  fail: 'FAIL_PNG',
};

const DEFAULT_CONFIG = {
  concurrency: 5,
  extensions: ['.png', '.jpg', '.jpeg', '.webp'],
  maxRetries: 3,
};

function normalizeConfig(rawConfig) {
  return rawConfig;
}

function ensureWorkDirs(baseDir) {
  return baseDir;
}

function scanImages(baseDir, extensions) {
  return [];
}

function getRelativePath(baseDir, folderName, filePath) {
  return path.relative(path.join(baseDir, folderName), filePath);
}

function getOutputPath(baseDir, folderName, relativePath) {
  return path.join(baseDir, folderName, relativePath);
}

function collectPendingSourceFiles(baseDir, extensions) {
  return [];
}

function copyToRetry(baseDir, sourceFile) {
  return sourceFile;
}

function moveRetrySuccess(baseDir, retryFile, outputBuffer) {
  return retryFile;
}

function moveRetryFailure(baseDir, retryFile) {
  return retryFile;
}

async function runQueue(items, concurrency, worker) {
  return Promise.all(items.map((item) => worker(item)));
}

function createTinifyClient(apiKey) {
  return { apiKey };
}

async function main() {
  console.log('TinyPNGTools is not implemented yet.');
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
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```cmd
node TEST\run-tests.js
```

Expected: PASS `exports required functions`.

---

### Task 2: Implement Config Validation

**Files:**
- Modify: `TinyPNGTools.js`
- Modify: `TEST/run-tests.js`

- [ ] **Step 1: Add failing config tests**

Append these tests to `TEST/run-tests.js` before `async function run()`:

```js
test('normalizes valid config with defaults', () => {
  const config = tool.normalizeConfig({ apiKey: 'abc123' });
  assert.deepStrictEqual(config, {
    apiKey: 'abc123',
    concurrency: 5,
    extensions: ['.png', '.jpg', '.jpeg', '.webp'],
    maxRetries: 3,
  });
});

test('normalizes extensions to lowercase with leading dot', () => {
  const config = tool.normalizeConfig({
    apiKey: 'abc123',
    concurrency: 2,
    extensions: ['PNG', '.JPG'],
    maxRetries: 1,
  });
  assert.deepStrictEqual(config.extensions, ['.png', '.jpg']);
  assert.strictEqual(config.concurrency, 2);
  assert.strictEqual(config.maxRetries, 1);
});

test('rejects invalid config values', () => {
  assert.throws(() => tool.normalizeConfig({}), /apiKey/);
  assert.throws(() => tool.normalizeConfig({ apiKey: 'abc', concurrency: 0 }), /concurrency/);
  assert.throws(() => tool.normalizeConfig({ apiKey: 'abc', extensions: [] }), /extensions/);
  assert.throws(() => tool.normalizeConfig({ apiKey: 'abc', maxRetries: -1 }), /maxRetries/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```cmd
node TEST\run-tests.js
```

Expected: FAIL on config assertions because `normalizeConfig` returns raw input.

- [ ] **Step 3: Implement `normalizeConfig`**

Replace `normalizeConfig` in `TinyPNGTools.js`:

```js
function normalizeConfig(rawConfig) {
  const input = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const config = {
    apiKey: input.apiKey,
    concurrency: input.concurrency === undefined ? DEFAULT_CONFIG.concurrency : input.concurrency,
    extensions: input.extensions === undefined ? DEFAULT_CONFIG.extensions : input.extensions,
    maxRetries: input.maxRetries === undefined ? DEFAULT_CONFIG.maxRetries : input.maxRetries,
  };

  if (typeof config.apiKey !== 'string' || config.apiKey.trim() === '') {
    throw new Error('config.json 中的 apiKey 必须是非空字符串。');
  }

  if (!Number.isInteger(config.concurrency) || config.concurrency < 1) {
    throw new Error('config.json 中的 concurrency 必须是正整数。');
  }

  if (!Array.isArray(config.extensions) || config.extensions.length === 0) {
    throw new Error('config.json 中的 extensions 必须是非空数组。');
  }

  config.extensions = config.extensions.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error('config.json 中的 extensions 只能包含非空字符串。');
    }
    const lower = item.trim().toLowerCase();
    return lower.startsWith('.') ? lower : `.${lower}`;
  });

  if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0) {
    throw new Error('config.json 中的 maxRetries 必须是非负整数。');
  }

  config.apiKey = config.apiKey.trim();
  return config;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```cmd
node TEST\run-tests.js
```

Expected: all config tests PASS.

---

### Task 3: Implement Directory and Path Helpers

**Files:**
- Modify: `TinyPNGTools.js`
- Modify: `TEST/run-tests.js`

- [ ] **Step 1: Add failing directory/path tests**

Append before `async function run()`:

```js
test('creates only work directories under provided base directory', () => {
  for (const name of DIRS) {
    removeDir(path.join(TEST_ROOT, name));
  }
  tool.ensureWorkDirs(TEST_ROOT);
  for (const name of DIRS) {
    assert.strictEqual(fs.statSync(path.join(TEST_ROOT, name)).isDirectory(), true);
  }
});

test('maps source relative path to output path', () => {
  const sourceFile = path.join(TEST_ROOT, 'SRC_PNG', 'nested', 'image.png');
  const relativePath = tool.getRelativePath(TEST_ROOT, 'SRC_PNG', sourceFile);
  assert.strictEqual(relativePath, path.join('nested', 'image.png'));
  assert.strictEqual(
    tool.getOutputPath(TEST_ROOT, 'OUT_PNG', relativePath),
    path.join(TEST_ROOT, 'OUT_PNG', 'nested', 'image.png')
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```cmd
node TEST\run-tests.js
```

Expected: directory creation test FAIL because `ensureWorkDirs` does not create directories.

- [ ] **Step 3: Implement `ensureWorkDirs` and harden path helpers**

Replace the three functions:

```js
function ensureWorkDirs(baseDir) {
  for (const folderName of Object.values(WORK_DIRS)) {
    fs.mkdirSync(path.join(baseDir, folderName), { recursive: true });
  }
}

function getRelativePath(baseDir, folderName, filePath) {
  return path.relative(path.join(baseDir, folderName), filePath);
}

function getOutputPath(baseDir, folderName, relativePath) {
  return path.join(baseDir, folderName, relativePath);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```cmd
node TEST\run-tests.js
```

Expected: all directory/path tests PASS.

---

### Task 4: Implement Image Scanning and Pending Source Detection

**Files:**
- Modify: `TinyPNGTools.js`
- Modify: `TEST/run-tests.js`

- [ ] **Step 1: Add failing scanner tests**

Append before `async function run()`:

```js
test('recursively scans supported image extensions only', () => {
  writeFile(path.join('SRC_PNG', 'a.png'), 'a');
  writeFile(path.join('SRC_PNG', 'nested', 'b.JPG'), 'b');
  writeFile(path.join('SRC_PNG', 'nested', 'c.gif'), 'c');
  writeFile(path.join('SRC_PNG', 'note.txt'), 'note');

  const files = tool.scanImages(path.join(TEST_ROOT, 'SRC_PNG'), ['.png', '.jpg']).map((item) =>
    path.relative(path.join(TEST_ROOT, 'SRC_PNG'), item)
  );

  assert.deepStrictEqual(files.sort(), [path.join('a.png'), path.join('nested', 'b.JPG')].sort());
});

test('collects source files missing from OUT_PNG', () => {
  writeFile(path.join('SRC_PNG', 'a.png'), 'a');
  writeFile(path.join('SRC_PNG', 'b.jpg'), 'b');
  writeFile(path.join('OUT_PNG', 'a.png'), 'compressed');

  const pending = tool.collectPendingSourceFiles(TEST_ROOT, ['.png', '.jpg']).map((item) =>
    path.relative(path.join(TEST_ROOT, 'SRC_PNG'), item)
  );

  assert.deepStrictEqual(pending, [path.join('b.jpg')]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```cmd
node TEST\run-tests.js
```

Expected: scanner tests FAIL because scanning returns empty arrays.

- [ ] **Step 3: Implement scanning helpers**

Replace `scanImages` and `collectPendingSourceFiles`:

```js
function scanImages(rootDir, extensions) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const normalizedExtensions = new Set(extensions.map((item) => item.toLowerCase()));
  const results = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (normalizedExtensions.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results.sort();
}

function collectPendingSourceFiles(baseDir, extensions) {
  const sourceRoot = path.join(baseDir, WORK_DIRS.src);
  const files = scanImages(sourceRoot, extensions);
  return files.filter((sourceFile) => {
    const relativePath = getRelativePath(baseDir, WORK_DIRS.src, sourceFile);
    const outputPath = getOutputPath(baseDir, WORK_DIRS.out, relativePath);
    return !fs.existsSync(outputPath);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```cmd
node TEST\run-tests.js
```

Expected: scanner and pending tests PASS.

---

### Task 5: Implement Retry and Failure File Movement

**Files:**
- Modify: `TinyPNGTools.js`
- Modify: `TEST/run-tests.js`

- [ ] **Step 1: Add failing retry/failure tests**

Append before `async function run()`:

```js
test('copies failed source file to RETRY_PNG with same relative path', () => {
  writeFile(path.join('SRC_PNG', 'nested', 'bad.png'), 'bad');
  const sourceFile = path.join(TEST_ROOT, 'SRC_PNG', 'nested', 'bad.png');

  const retryFile = tool.copyToRetry(TEST_ROOT, sourceFile);

  assert.strictEqual(retryFile, path.join(TEST_ROOT, 'RETRY_PNG', 'nested', 'bad.png'));
  assert.strictEqual(exists(path.join('RETRY_PNG', 'nested', 'bad.png')), true);
});

test('moves retry success to OUT_PNG and removes RETRY_PNG file', () => {
  writeFile(path.join('RETRY_PNG', 'nested', 'ok.webp'), 'retry');
  const retryFile = path.join(TEST_ROOT, 'RETRY_PNG', 'nested', 'ok.webp');

  tool.moveRetrySuccess(TEST_ROOT, retryFile, Buffer.from('compressed'));

  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'OUT_PNG', 'nested', 'ok.webp'), 'utf8'), 'compressed');
  assert.strictEqual(exists(path.join('RETRY_PNG', 'nested', 'ok.webp')), false);
});

test('moves retry failure to FAIL_PNG and removes RETRY_PNG file', () => {
  writeFile(path.join('SRC_PNG', 'nested', 'fail.jpg'), 'source');
  writeFile(path.join('RETRY_PNG', 'nested', 'fail.jpg'), 'retry');
  const retryFile = path.join(TEST_ROOT, 'RETRY_PNG', 'nested', 'fail.jpg');

  tool.moveRetryFailure(TEST_ROOT, retryFile);

  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'FAIL_PNG', 'nested', 'fail.jpg'), 'utf8'), 'source');
  assert.strictEqual(exists(path.join('RETRY_PNG', 'nested', 'fail.jpg')), false);
});

test('moves retry-only failure sample to FAIL_PNG when source is missing', () => {
  writeFile(path.join('RETRY_PNG', 'orphan.png'), 'retry-only');
  const retryFile = path.join(TEST_ROOT, 'RETRY_PNG', 'orphan.png');

  tool.moveRetryFailure(TEST_ROOT, retryFile);

  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'FAIL_PNG', 'orphan.png'), 'utf8'), 'retry-only');
  assert.strictEqual(exists(path.join('RETRY_PNG', 'orphan.png')), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```cmd
node TEST\run-tests.js
```

Expected: retry tests FAIL because movement functions are stubs.

- [ ] **Step 3: Add file helper functions and implement retry movement**

Add helper functions after `getOutputPath`:

```js
function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function removeEmptyParents(startDir, stopDir) {
  let current = startDir;
  while (current.startsWith(stopDir) && current !== stopDir) {
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
```

Replace `copyToRetry`, `moveRetrySuccess`, and `moveRetryFailure`:

```js
function copyToRetry(baseDir, sourceFile) {
  const relativePath = getRelativePath(baseDir, WORK_DIRS.src, sourceFile);
  const retryFile = getOutputPath(baseDir, WORK_DIRS.retry, relativePath);
  ensureParentDir(retryFile);
  fs.copyFileSync(sourceFile, retryFile);
  return retryFile;
}

function moveRetrySuccess(baseDir, retryFile, outputBuffer) {
  const relativePath = getRelativePath(baseDir, WORK_DIRS.retry, retryFile);
  const outputPath = getOutputPath(baseDir, WORK_DIRS.out, relativePath);
  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, outputBuffer);
  fs.rmSync(retryFile, { force: true });
  removeEmptyParents(path.dirname(retryFile), path.join(baseDir, WORK_DIRS.retry));
  return outputPath;
}

function moveRetryFailure(baseDir, retryFile) {
  const relativePath = getRelativePath(baseDir, WORK_DIRS.retry, retryFile);
  const sourceFile = getOutputPath(baseDir, WORK_DIRS.src, relativePath);
  const failFile = getOutputPath(baseDir, WORK_DIRS.fail, relativePath);
  const fileToCopy = fs.existsSync(sourceFile) ? sourceFile : retryFile;
  ensureParentDir(failFile);
  fs.copyFileSync(fileToCopy, failFile);
  fs.rmSync(retryFile, { force: true });
  removeEmptyParents(path.dirname(retryFile), path.join(baseDir, WORK_DIRS.retry));
  return failFile;
}
```

Add `ensureParentDir` and `removeEmptyParents` to `module.exports` only if tests need them later; otherwise keep them private.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```cmd
node TEST\run-tests.js
```

Expected: retry/failure tests PASS.

---

### Task 6: Implement Concurrency Queue

**Files:**
- Modify: `TinyPNGTools.js`
- Modify: `TEST/run-tests.js`

- [ ] **Step 1: Add failing queue test**

Append before `async function run()`:

```js
test('runQueue respects concurrency limit and preserves result order', async () => {
  let active = 0;
  let maxActive = 0;
  const results = await tool.runQueue([1, 2, 3, 4, 5], 2, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return item * 10;
  });

  assert.deepStrictEqual(results, [10, 20, 30, 40, 50]);
  assert.strictEqual(maxActive, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```cmd
node TEST\run-tests.js
```

Expected: FAIL because current `runQueue` runs all items at once.

- [ ] **Step 3: Implement bounded concurrency**

Replace `runQueue`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```cmd
node TEST\run-tests.js
```

Expected: queue test PASS.

---

### Task 7: Implement Tinify HTTP Client

**Files:**
- Modify: `TinyPNGTools.js`
- Modify: `TEST/run-tests.js`

- [ ] **Step 1: Add failing Tinify client tests with a mock request function**

Append before `async function run()`:

```js
test('Tinify client uploads binary data and downloads from Location', async () => {
  const calls = [];
  const request = async (options, body) => {
    calls.push({ options, body });
    if (options.path === '/shrink') {
      return { statusCode: 201, headers: { location: 'https://api.tinify.com/output/abc' }, body: Buffer.from('') };
    }
    if (options.path === '/output/abc') {
      return { statusCode: 200, headers: {}, body: Buffer.from('compressed') };
    }
    throw new Error(`unexpected path ${options.path}`);
  };

  const client = tool.createTinifyClient('secret-key', request);
  const result = await client.compress(Buffer.from('source-image'));

  assert.strictEqual(result.toString(), 'compressed');
  assert.strictEqual(calls[0].options.method, 'POST');
  assert.strictEqual(calls[0].options.hostname, 'api.tinify.com');
  assert.strictEqual(calls[0].options.path, '/shrink');
  assert.strictEqual(calls[0].options.headers.Authorization, `Basic ${Buffer.from('api:secret-key').toString('base64')}`);
  assert.strictEqual(calls[0].body.toString(), 'source-image');
});

test('Tinify client throws readable error when upload fails', async () => {
  const request = async () => ({
    statusCode: 401,
    headers: {},
    body: Buffer.from(JSON.stringify({ error: 'Unauthorized', message: 'Credentials are invalid' })),
  });
  const client = tool.createTinifyClient('bad-key', request);

  await assert.rejects(() => client.compress(Buffer.from('source-image')), /Tinify 上传失败 401/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```cmd
node TEST\run-tests.js
```

Expected: FAIL because `createTinifyClient` does not expose `compress`.

- [ ] **Step 3: Implement request helpers and Tinify client**

Add after `runQueue`:

```js
function parseJsonMessage(buffer) {
  try {
    const data = JSON.parse(buffer.toString('utf8'));
    return data.message || data.error || buffer.toString('utf8');
  } catch (error) {
    return buffer.toString('utf8');
  }
}

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
```

Replace `createTinifyClient`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```cmd
node TEST\run-tests.js
```

Expected: Tinify client tests PASS without calling the real network.

---

### Task 8: Implement Compression Orchestration

**Files:**
- Modify: `TinyPNGTools.js`
- Modify: `TEST/run-tests.js`

- [ ] **Step 1: Add failing orchestration tests**

Append before `async function run()`:

```js
test('processes pending source files into OUT_PNG and reports summary', async () => {
  writeFile(path.join('SRC_PNG', 'a.png'), 'a');
  writeFile(path.join('SRC_PNG', 'nested', 'b.jpg'), 'b');

  const client = {
    compress: async (buffer) => Buffer.from(`compressed:${buffer.toString()}`),
  };

  const summary = await tool.runCompressionFlow({
    baseDir: TEST_ROOT,
    config: { apiKey: 'abc', concurrency: 2, extensions: ['.png', '.jpg'], maxRetries: 3 },
    client,
    logger: { log() {}, error() {} },
    promptRetry: async () => true,
  });

  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'OUT_PNG', 'a.png'), 'utf8'), 'compressed:a');
  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'OUT_PNG', 'nested', 'b.jpg'), 'utf8'), 'compressed:b');
  assert.strictEqual(summary.total, 2);
  assert.strictEqual(summary.success, 2);
  assert.strictEqual(summary.failed, 0);
});

test('failed source files retry three times then move to FAIL_PNG', async () => {
  writeFile(path.join('SRC_PNG', 'bad.png'), 'bad');
  let calls = 0;
  const client = {
    compress: async () => {
      calls += 1;
      throw new Error('network down');
    },
  };

  const summary = await tool.runCompressionFlow({
    baseDir: TEST_ROOT,
    config: { apiKey: 'abc', concurrency: 1, extensions: ['.png'], maxRetries: 3 },
    client,
    logger: { log() {}, error() {} },
    promptRetry: async () => true,
  });

  assert.strictEqual(calls, 4);
  assert.strictEqual(exists(path.join('FAIL_PNG', 'bad.png')), true);
  assert.strictEqual(exists(path.join('RETRY_PNG', 'bad.png')), false);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(summary.success, 0);
  assert.strictEqual(summary.failed, 1);
});

test('existing retry files are processed before pending source files', async () => {
  writeFile(path.join('SRC_PNG', 'retry.png'), 'source-retry');
  writeFile(path.join('SRC_PNG', 'new.png'), 'new');
  writeFile(path.join('RETRY_PNG', 'retry.png'), 'retry');
  const order = [];
  const client = {
    compress: async (buffer) => {
      order.push(buffer.toString());
      return Buffer.from(`compressed:${buffer.toString()}`);
    },
  };

  const summary = await tool.runCompressionFlow({
    baseDir: TEST_ROOT,
    config: { apiKey: 'abc', concurrency: 1, extensions: ['.png'], maxRetries: 3 },
    client,
    logger: { log() {}, error() {} },
    promptRetry: async () => true,
  });

  assert.deepStrictEqual(order, ['retry', 'new']);
  assert.strictEqual(summary.success, 2);
});

test('declining retry clears RETRY_PNG and OUT_PNG before new source compression', async () => {
  writeFile(path.join('SRC_PNG', 'a.png'), 'a');
  writeFile(path.join('RETRY_PNG', 'old.png'), 'old');
  writeFile(path.join('OUT_PNG', 'old.png'), 'old-output');
  const client = {
    compress: async (buffer) => Buffer.from(`compressed:${buffer.toString()}`),
  };

  const summary = await tool.runCompressionFlow({
    baseDir: TEST_ROOT,
    config: { apiKey: 'abc', concurrency: 1, extensions: ['.png'], maxRetries: 3 },
    client,
    logger: { log() {}, error() {} },
    promptRetry: async () => false,
  });

  assert.strictEqual(exists(path.join('RETRY_PNG', 'old.png')), false);
  assert.strictEqual(exists(path.join('OUT_PNG', 'old.png')), false);
  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'OUT_PNG', 'a.png'), 'utf8'), 'compressed:a');
  assert.strictEqual(summary.success, 1);
});
```

Also update the exports test to include:

```js
assert.strictEqual(typeof tool.runCompressionFlow, 'function');
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```cmd
node TEST\run-tests.js
```

Expected: FAIL because `runCompressionFlow` is not defined.

- [ ] **Step 3: Implement orchestration helpers**

Add these functions before `main`:

```js
function clearDirectory(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function hasRetryFiles(baseDir, extensions) {
  return scanImages(path.join(baseDir, WORK_DIRS.retry), extensions).length > 0;
}

async function compressSourceFile(baseDir, sourceFile, client, logger) {
  const relativePath = getRelativePath(baseDir, WORK_DIRS.src, sourceFile);
  logger.log(`上传: ${relativePath}`);
  const inputBuffer = fs.readFileSync(sourceFile);
  const outputBuffer = await client.compress(inputBuffer);
  const outputPath = getOutputPath(baseDir, WORK_DIRS.out, relativePath);
  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, outputBuffer);
  logger.log(`下载完成: ${relativePath}`);
  return outputPath;
}

async function compressRetryFile(baseDir, retryFile, client, logger) {
  const relativePath = getRelativePath(baseDir, WORK_DIRS.retry, retryFile);
  logger.log(`重试上传: ${relativePath}`);
  const inputBuffer = fs.readFileSync(retryFile);
  const outputBuffer = await client.compress(inputBuffer);
  const outputPath = moveRetrySuccess(baseDir, retryFile, outputBuffer);
  logger.log(`重试成功: ${relativePath}`);
  return outputPath;
}

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

async function processSourceFiles(baseDir, config, client, logger, summary) {
  const pending = collectPendingSourceFiles(baseDir, config.extensions);
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

async function runCompressionFlow(options) {
  const { baseDir, config, client, logger, promptRetry } = options;
  const summary = { total: 0, success: 0, failed: 0 };

  ensureWorkDirs(baseDir);

  if (hasRetryFiles(baseDir, config.extensions)) {
    const shouldRetry = await promptRetry();
    if (shouldRetry) {
      const retryCount = scanImages(path.join(baseDir, WORK_DIRS.retry), config.extensions).length;
      summary.total += retryCount;
      await retryFailedFiles(baseDir, config, client, logger, summary);
    } else {
      clearDirectory(path.join(baseDir, WORK_DIRS.retry));
      clearDirectory(path.join(baseDir, WORK_DIRS.out));
    }
  }

  await processSourceFiles(baseDir, config, client, logger, summary);
  return summary;
}
```

Add `runCompressionFlow` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```cmd
node TEST\run-tests.js
```

Expected: orchestration tests PASS.

---

### Task 9: Implement CLI Entry, Config Loading, Retry Prompt, and Final Output

**Files:**
- Modify: `TinyPNGTools.js`
- Modify: `TEST/run-tests.js`
- Create: `config.example.json`

- [ ] **Step 1: Add failing CLI helper tests**

Append before `async function run()`:

```js
test('loads config JSON from a provided base directory', () => {
  fs.writeFileSync(
    path.join(TEST_ROOT, 'config.json'),
    JSON.stringify({ apiKey: 'abc', concurrency: 4, extensions: ['png'], maxRetries: 2 }, null, 2)
  );

  const config = tool.loadConfig(TEST_ROOT);

  assert.strictEqual(config.apiKey, 'abc');
  assert.strictEqual(config.concurrency, 4);
  assert.deepStrictEqual(config.extensions, ['.png']);
  assert.strictEqual(config.maxRetries, 2);
});

test('formats final summary with completion marker', () => {
  const text = tool.formatSummary({ total: 3, success: 2, failed: 1 });
  assert.match(text, /总共处理图片: 3/);
  assert.match(text, /成功压缩图片: 2/);
  assert.match(text, /失败图片: 1/);
  assert.match(text, /TinyPNG_ALL_COMPLETED/);
});
```

Update the exports test to include:

```js
assert.strictEqual(typeof tool.loadConfig, 'function');
assert.strictEqual(typeof tool.formatSummary, 'function');
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```cmd
node TEST\run-tests.js
```

Expected: FAIL because `loadConfig` and `formatSummary` are missing.

- [ ] **Step 3: Implement config loading, prompt, summary, and CLI main**

Add these functions before `main`:

```js
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

function formatSummary(summary) {
  return [
    `总共处理图片: ${summary.total}`,
    `成功压缩图片: ${summary.success}`,
    `失败图片: ${summary.failed}`,
    'TinyPNG_ALL_COMPLETED',
  ].join('\n');
}
```

Replace `main`:

```js
async function main() {
  const baseDir = __dirname;
  const config = loadConfig(baseDir);
  const client = createTinifyClient(config.apiKey);
  const summary = await runCompressionFlow({
    baseDir,
    config,
    client,
    logger: console,
    promptRetry: () => askYesNo('检测到 RETRY_PNG 中有未完成文件，是否重试'),
  });

  console.log(formatSummary(summary));
}
```

Add `loadConfig`, `askYesNo`, and `formatSummary` to `module.exports`.

- [ ] **Step 4: Create config example**

Create `config.example.json`:

```json
{
  "apiKey": "TinyPNG_API_KEY",
  "concurrency": 5,
  "extensions": [".png", ".jpg", ".jpeg", ".webp"],
  "maxRetries": 3
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```cmd
node TEST\run-tests.js
```

Expected: all tests PASS.

---

### Task 10: Write Chinese README

**Files:**
- Replace: `README.md`

- [ ] **Step 1: Replace README with Chinese usage docs**

Replace `README.md` with:

```md
# TinyPNGTools

TinyPNGTools 是一个用 TinyPNG/Tinify HTTP API 批量压缩图片的 Node.js 命令行工具。

工具会读取当前工具目录下 `SRC_PNG` 中的图片，上传到 TinyPNG 服务器压缩，再把结果下载到 `OUT_PNG`。输出文件的相对路径和文件名会与 `SRC_PNG` 保持一致。

## 功能

- 支持 `.png`、`.jpg`、`.jpeg`、`.webp`
- 支持递归扫描子目录
- 支持批量并发压缩，默认并发 `5`
- 支持断点续处理：`OUT_PNG` 已存在的同路径文件会跳过
- 支持失败文件进入 `RETRY_PNG`
- 支持自动重试，默认重试 `3` 次
- 重试失败后进入 `FAIL_PNG`
- 自动测试固定运行在 `TEST` 目录，不影响真实图片目录

## 目录结构

正式运行目录：

```text
SRC_PNG
OUT_PNG
RETRY_PNG
FAIL_PNG
```

自动测试目录：

```text
TEST/SRC_PNG
TEST/OUT_PNG
TEST/RETRY_PNG
TEST/FAIL_PNG
```

## 配置

复制 `config.example.json` 为 `config.json`，然后填写自己的 TinyPNG API Key。

```json
{
  "apiKey": "TinyPNG_API_KEY",
  "concurrency": 5,
  "extensions": [".png", ".jpg", ".jpeg", ".webp"],
  "maxRetries": 3
}
```

## 运行

把需要压缩的图片放入 `SRC_PNG`，然后在 cmd 中运行：

```cmd
node TinyPNGTools.js
```

所有流程完成后会输出：

```text
TinyPNG_ALL_COMPLETED
```

## 未完成任务处理

如果启动时检测到 `RETRY_PNG` 中有文件，工具会询问是否重试。

选择重试时：

- 先压缩 `RETRY_PNG` 中的文件
- 重试成功后写入 `OUT_PNG`
- 重试成功的文件会从 `RETRY_PNG` 删除
- 然后继续处理 `SRC_PNG` 中尚未输出到 `OUT_PNG` 的文件

选择不重试时：

- 清空 `RETRY_PNG`
- 清空 `OUT_PNG`
- 从 `SRC_PNG` 重新开始压缩

## 自动测试

运行：

```cmd
node TEST\run-tests.js
```

自动测试只操作 `TEST` 目录下的四个图片目录，不会处理真实运行目录中的图片。

## TinyPNG API 文档

https://tinify.com/developers/reference/http
```

- [ ] **Step 2: Run tests after docs change**

Run:

```cmd
node TEST\run-tests.js
```

Expected: all tests still PASS.

---

### Task 11: Final Verification

**Files:**
- Verify all created and modified files.

- [ ] **Step 1: Run automated tests**

Run:

```cmd
node TEST\run-tests.js
```

Expected:

```text
All tests passed: <number>
```

- [ ] **Step 2: Verify no real API key is committed in example files**

Run:

```cmd
findstr /S /I "apiKey" README.md config.example.json TinyPNGTools.js
```

Expected:

- `config.example.json` contains only `TinyPNG_API_KEY`.
- `README.md` contains only example placeholder text.
- `TinyPNGTools.js` contains config field names only, not a real key.

- [ ] **Step 3: Verify test isolation**

Run:

```cmd
node TEST\run-tests.js
```

Then inspect that test files exist only under:

```text
TEST/SRC_PNG
TEST/OUT_PNG
TEST/RETRY_PNG
TEST/FAIL_PNG
```

Expected: no test image files are created in root-level `SRC_PNG`, `OUT_PNG`, `RETRY_PNG`, or `FAIL_PNG`.

---

## Self-Review Notes

- Spec coverage: covered config, four runtime directories, four test directories, Tinify upload/download, Basic Auth, concurrency 5, supported extensions, retry prompt, retry 3 times, failure movement to `FAIL_PNG`, final summary, and completion marker.
- Placeholder scan: no implementation step uses placeholder language.
- Type consistency: core function names are introduced in Task 1 and reused consistently in later tasks.
- User preference: git commands are intentionally omitted; user handles git manually.
