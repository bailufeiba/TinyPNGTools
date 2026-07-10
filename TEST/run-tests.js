const assert = require('assert');
const crypto = require('crypto');
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

function md5(content) {
  return crypto.createHash('md5').update(Buffer.from(content)).digest('hex');
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
  assert.strictEqual(typeof tool.runCompressionFlow, 'function');
  assert.strictEqual(typeof tool.createTinifyClient, 'function');
  assert.strictEqual(typeof tool.loadConfig, 'function');
  assert.strictEqual(typeof tool.formatSummary, 'function');
  assert.strictEqual(typeof tool.generateFileList, 'function');
  assert.strictEqual(typeof tool.syncSourceToWorkDirs, 'function');
  assert.strictEqual(typeof tool.updateSrcPngJson, 'function');
  assert.strictEqual(typeof tool.copyOutputsToSource, 'function');
  assert.strictEqual(typeof tool.loadIgnoreList, 'function');
  assert.strictEqual(typeof tool.clearCache, 'function');
  assert.strictEqual(typeof tool.formatHelp, 'function');
});

test('exports planned work directory keys', () => {
  assert.deepStrictEqual(tool.WORK_DIRS, {
    src: 'SRC_PNG',
    out: 'OUT_PNG',
    retry: 'RETRY_PNG',
    fail: 'FAIL_PNG',
  });
});

test('normalizeConfig clones default extensions', () => {
  const config = tool.normalizeConfig({ apiKey: 'abc123' });

  config.extensions.push('.gif');

  assert.deepStrictEqual(tool.DEFAULT_CONFIG.extensions, ['.png', '.jpg', '.jpeg', '.webp']);
});

test('exported default extensions cannot change normalization defaults', () => {
  assert.strictEqual(Object.isFrozen(tool.DEFAULT_CONFIG), true);
  assert.strictEqual(Object.isFrozen(tool.DEFAULT_CONFIG.extensions), true);

  assert.throws(() => {
    tool.DEFAULT_CONFIG.extensions.push('.gif');
  }, TypeError);

  const config = tool.normalizeConfig({ apiKey: 'abc' });

  assert.deepStrictEqual(config.extensions, ['.png', '.jpg', '.jpeg', '.webp']);
  assert.notStrictEqual(config.extensions, tool.DEFAULT_CONFIG.extensions);
});

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

test('creates only work directories under provided base directory', () => {
  const rootDirsMissingBefore = DIRS.filter((name) => !fs.existsSync(path.join(__dirname, '..', name)));
  for (const name of DIRS) {
    removeDir(path.join(TEST_ROOT, name));
  }
  tool.ensureWorkDirs(TEST_ROOT);
  for (const name of DIRS) {
    assert.strictEqual(fs.statSync(path.join(TEST_ROOT, name)).isDirectory(), true);
  }
  for (const name of rootDirsMissingBefore) {
    assert.strictEqual(fs.existsSync(path.join(__dirname, '..', name)), false);
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

test('rejects source files outside requested work directory', () => {
  const outsideFile = path.join(TEST_ROOT, 'OUT_PNG', 'nested', 'image.png');

  assert.throws(
    () => tool.getRelativePath(TEST_ROOT, 'SRC_PNG', outsideFile),
    /outside|目录|path/i
  );
});

test('rejects output paths escaping requested work directory', () => {
  assert.throws(
    () => tool.getOutputPath(TEST_ROOT, 'OUT_PNG', path.join('..', 'FAIL_PNG', 'image.png')),
    /outside|目录|path/i
  );
});

test('rejects absolute output relative paths', () => {
  assert.throws(
    () => tool.getOutputPath(TEST_ROOT, 'OUT_PNG', path.join(TEST_ROOT, 'FAIL_PNG', 'image.png')),
    /outside|目录|path/i
  );
});

test('recursively scans supported image extensions only', () => {
  writeFile(path.join('SRC_PNG', 'a.png'), 'a');
  writeFile(path.join('SRC_PNG', 'nested', 'b.JPG'), 'b');
  writeFile(path.join('SRC_PNG', 'nested', 'c.gif'), 'c');
  writeFile(path.join('SRC_PNG', 'note.txt'), 'note');

  const files = tool.scanImages(path.join(TEST_ROOT, 'SRC_PNG'), ['.png', '.jpg']).map((item) =>
    path.relative(path.join(TEST_ROOT, 'SRC_PNG'), item)
  );

  assert.deepStrictEqual(files, [path.join('a.png'), path.join('nested', 'b.JPG')]);
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

test('skips source only when output path is a file, not a directory', () => {
  writeFile(path.join('SRC_PNG', 'x.png'), 'x');
  writeFile(path.join('SRC_PNG', 'y.png'), 'y');
  writeFile(path.join('OUT_PNG', 'y.png'), 'compressed');
  // Create a directory at the expected output path for x.png — should still be pending
  fs.mkdirSync(path.join(TEST_ROOT, 'OUT_PNG', 'x.png'), { recursive: true });

  const pending = tool.collectPendingSourceFiles(TEST_ROOT, ['.png']).map((item) =>
    path.relative(path.join(TEST_ROOT, 'SRC_PNG'), item)
  );

  assert.deepStrictEqual(pending, [path.join('x.png')]);
});



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

test('removeEmptyParents stops at stopDir and does not walk above it', () => {
  const stopDir = path.join(TEST_ROOT, 'cleanup_root');
  fs.mkdirSync(stopDir, { recursive: true });
  const insideA = path.join(stopDir, 'a');
  const insideB = path.join(insideA, 'b');
  fs.mkdirSync(insideB, { recursive: true });
  // b should be empty, a is also empty after b is removed

  tool.removeEmptyParents(insideB, stopDir);

  // Both empty dirs under stopDir should be cleaned up
  assert.strictEqual(fs.existsSync(insideB), false);
  assert.strictEqual(fs.existsSync(insideA), false);
  // stopDir itself must remain
  assert.strictEqual(fs.existsSync(stopDir), true);

  // Boundary: a path whose string starts with stopDir but is not a subdirectory
  const decoyDir = stopDir + 'Extra';
  const decoySub = path.join(decoyDir, 'sub');
  const decoyLeaf = path.join(decoySub, 'leaf');
  fs.mkdirSync(decoyLeaf, { recursive: true });

  tool.removeEmptyParents(decoyLeaf, stopDir);

  // decoy directories must remain untouched
  assert.strictEqual(fs.existsSync(decoyLeaf), true);
  assert.strictEqual(fs.existsSync(decoySub), true);
  assert.strictEqual(fs.existsSync(decoyDir), true);

  // Clean up decoy dirs manually since they are outside stopDir
  fs.rmSync(decoyDir, { recursive: true, force: true });
  fs.rmSync(stopDir, { recursive: true, force: true });
});

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

test('compressSourceFile records source and output md5 values', async () => {
  writeFile(path.join('SRC_PNG', 'manifest.png'), 'source-image');
  const client = {
    compress: async (buffer) => Buffer.from(`compressed:${buffer.toString()}`),
  };

  await tool.compressSourceFile(
    TEST_ROOT,
    path.join(TEST_ROOT, 'SRC_PNG', 'manifest.png'),
    client,
    { log() {}, error() {} }
  );

  const data = JSON.parse(fs.readFileSync(path.join(TEST_ROOT, 'SRC_PNG.json'), 'utf8'));
  const entry = data.files.find((item) => item.path === 'manifest.png');
  assert.deepStrictEqual(entry, {
    path: 'manifest.png',
    src_md5: md5('source-image'),
    out_md5: md5('compressed:source-image'),
  });
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

test('declining retry clears only RETRY_PNG and keeps OUT_PNG before new source compression', async () => {
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
  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'OUT_PNG', 'old.png'), 'utf8'), 'old-output');
  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'OUT_PNG', 'a.png'), 'utf8'), 'compressed:a');
  assert.strictEqual(summary.success, 1);
});

test('source mode clears RETRY_PNG without prompting and processes only provided source files', async () => {
  writeFile(path.join('SRC_PNG', 'changed.png'), 'changed');
  writeFile(path.join('SRC_PNG', 'untouched.png'), 'untouched');
  writeFile(path.join('RETRY_PNG', 'old.png'), 'old');
  let prompted = false;
  const compressed = [];
  const client = {
    compress: async (buffer) => {
      compressed.push(buffer.toString());
      return Buffer.from(`compressed:${buffer.toString()}`);
    },
  };

  const summary = await tool.runCompressionFlow({
    baseDir: TEST_ROOT,
    config: { apiKey: 'abc', concurrency: 1, extensions: ['.png'], maxRetries: 3 },
    client,
    logger: { log() {}, error() {} },
    promptRetry: async () => {
      prompted = true;
      return true;
    },
    sourceFiles: [path.join(TEST_ROOT, 'SRC_PNG', 'changed.png')],
    skipRetryCheck: true,
  });

  assert.strictEqual(prompted, false);
  assert.strictEqual(exists(path.join('RETRY_PNG', 'old.png')), false);
  assert.deepStrictEqual(compressed, ['changed']);
  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'OUT_PNG', 'changed.png'), 'utf8'), 'compressed:changed');
  assert.strictEqual(exists(path.join('OUT_PNG', 'untouched.png')), false);
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(summary.success, 1);
});

test('clearCache clears work directories, removes todo, and resets SRC_PNG manifest', () => {
  for (const name of DIRS) {
    writeFile(path.join(name, 'nested', `${name}.png`), name);
  }
  fs.writeFileSync(path.join(TEST_ROOT, 'todo.json'), JSON.stringify({ files: [{ path: 'a.png' }] }));
  fs.writeFileSync(path.join(TEST_ROOT, 'SRC_PNG.json'), JSON.stringify({
    files: [{ path: 'a.png', md5: 'abc' }]
  }));

  tool.clearCache(TEST_ROOT);

  for (const name of DIRS) {
    const dirPath = path.join(TEST_ROOT, name);
    assert.strictEqual(fs.statSync(dirPath).isDirectory(), true);
    assert.deepStrictEqual(fs.readdirSync(dirPath), []);
  }
  assert.strictEqual(fs.existsSync(path.join(TEST_ROOT, 'todo.json')), false);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(TEST_ROOT, 'SRC_PNG.json'), 'utf8')),
    { files: [] }
  );
});

test('formatHelp lists supported commands and options', () => {
  const help = tool.formatHelp();

  assert.match(help, /TinyPNGTools/);
  assert.match(help, /node TinyPNGTools\.js$/m);
  assert.match(help, /--source <dir>/);
  assert.match(help, /--ignore <path>/);
  assert.match(help, /clear/);
  assert.match(help, /--help, -h/);
});

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

test('generateFileList returns paths relative to given dir with md5', () => {
  writeFile(path.join('SRC_PNG', 'a.png'), 'hello');
  writeFile(path.join('SRC_PNG', 'nested', 'b.jpg'), 'world');
  writeFile(path.join('SRC_PNG', 'note.txt'), 'not-image');

  const result = tool.generateFileList(path.join(TEST_ROOT, 'SRC_PNG'), ['.png', '.jpg']);
  const paths = result.files.map(f => f.path).sort();

  assert.strictEqual(paths.length, 2);
  assert.deepStrictEqual(paths, ['a.png', path.join('nested', 'b.jpg')].sort());
  for (const f of result.files) {
    assert.strictEqual(typeof f.md5, 'string');
    assert.strictEqual(f.md5.length, 32);
  }
});

test('syncSourceToWorkDirs copies changed files and clears old outputs', () => {
  const sourceDir = path.join(TEST_ROOT, 'SRC_PNG');
  writeFile(path.join('SRC_PNG', 'new.png'), 'new-content');
  writeFile(path.join('SRC_PNG', 'changed.png'), 'changed-content');
  writeFile(path.join('OUT_PNG', 'changed.png'), 'old-output');
  writeFile(path.join('OUT_PNG', 'unchanged.png'), 'keep-output');

  fs.writeFileSync(path.join(TEST_ROOT, 'SRC_PNG.json'), JSON.stringify({
    files: [
      { path: 'changed.png', md5: '00000000000000000000000000000000' },
      { path: 'unchanged.png', md5: tool.generateFileList(sourceDir, ['.png']).files.find(f=>f.path==='unchanged.png')?.md5 || '???' }
    ]
  }));

  const result = tool.syncSourceToWorkDirs(TEST_ROOT, sourceDir, ['.png']);

  assert.strictEqual(result.changedFiles.includes('new.png'), true);
  assert.strictEqual(result.changedFiles.includes('changed.png'), true);
  assert.strictEqual(fs.existsSync(path.join(TEST_ROOT, 'OUT_PNG', 'changed.png')), false);
  assert.strictEqual(fs.existsSync(path.join(TEST_ROOT, 'todo.json')), true);
});

test('syncSourceToWorkDirs copies cached output to source when src md5 matches and output exists', () => {
  const sourceDir = path.join(TEST_ROOT, 'EXTERNAL_SRC_CACHE');
  removeDir(sourceDir);
  fs.mkdirSync(sourceDir, { recursive: true });
  const sourceFile = path.join(sourceDir, 'already-compressed.png');
  fs.writeFileSync(sourceFile, 'source-content');
  writeFile(path.join('OUT_PNG', 'already-compressed.png'), 'compressed-output');

  fs.writeFileSync(path.join(TEST_ROOT, 'SRC_PNG.json'), JSON.stringify({
    files: [{
      path: 'already-compressed.png',
      src_md5: md5('source-content'),
      out_md5: md5('compressed-output')
    }]
  }));

  const result = tool.syncSourceToWorkDirs(TEST_ROOT, sourceDir, ['.png']);

  assert.deepStrictEqual(result.changedFiles, []);
  assert.strictEqual(fs.readFileSync(sourceFile, 'utf8'), 'compressed-output');
  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'SRC_PNG', 'already-compressed.png'), 'utf8'), 'source-content');
  removeDir(sourceDir);
});

test('syncSourceToWorkDirs compresses matched manifest files when cached output is missing', () => {
  const sourceDir = path.join(TEST_ROOT, 'EXTERNAL_SRC_NO_CACHE');
  removeDir(sourceDir);
  fs.mkdirSync(sourceDir, { recursive: true });
  const sourceFile = path.join(sourceDir, 'missing-output.png');
  fs.writeFileSync(sourceFile, 'source-content');

  fs.writeFileSync(path.join(TEST_ROOT, 'SRC_PNG.json'), JSON.stringify({
    files: [{
      path: 'missing-output.png',
      src_md5: md5('source-content'),
      out_md5: '00000000000000000000000000000000'
    }]
  }));

  const result = tool.syncSourceToWorkDirs(TEST_ROOT, sourceDir, ['.png']);

  assert.deepStrictEqual(result.changedFiles, ['missing-output.png']);
  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'SRC_PNG', 'missing-output.png'), 'utf8'), 'source-content');
  removeDir(sourceDir);
});

test('updateSrcPngJson adds new entry and updates existing', () => {
  fs.writeFileSync(path.join(TEST_ROOT, 'SRC_PNG.json'), JSON.stringify({
    files: [{ path: 'a.png', src_md5: 'aaa' }]
  }));

  tool.updateSrcPngJson(TEST_ROOT, 'b.jpg', 'bbb', 'bbb2');
  tool.updateSrcPngJson(TEST_ROOT, 'a.png', 'aaa2', 'aaa3');

  const data = JSON.parse(fs.readFileSync(path.join(TEST_ROOT, 'SRC_PNG.json'), 'utf8'));
  const byPath = Object.fromEntries(data.files.map(f => [f.path, f]));
  assert.deepStrictEqual(byPath['a.png'], { path: 'a.png', src_md5: 'aaa2', out_md5: 'aaa3' });
  assert.deepStrictEqual(byPath['b.jpg'], { path: 'b.jpg', src_md5: 'bbb', out_md5: 'bbb2' });
});

test('copyOutputsToSource copies compressed files back to source directory', () => {
  const sourceDir = path.join(TEST_ROOT, 'SRC_PNG');
  writeFile(path.join('OUT_PNG', 'x.png'), 'compressed-x');
  writeFile(path.join('OUT_PNG', 'nested', 'y.jpg'), 'compressed-y');

  tool.copyOutputsToSource(TEST_ROOT, sourceDir, ['x.png', path.join('nested', 'y.jpg')]);

  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'SRC_PNG', 'x.png'), 'utf8'), 'compressed-x');
  assert.strictEqual(fs.readFileSync(path.join(TEST_ROOT, 'SRC_PNG', 'nested', 'y.jpg'), 'utf8'), 'compressed-y');
});

test('syncSourceToWorkDirs skips ignored files and removes their outputs', () => {
  const sourceDir = path.join(TEST_ROOT, 'SRC_PNG');
  writeFile(path.join('SRC_PNG', 'new.png'), 'new-content');
  writeFile(path.join('SRC_PNG', 'ignored.png'), 'ignore-me');
  writeFile(path.join('OUT_PNG', 'ignored.png'), 'old-output');
  writeFile(path.join('OUT_PNG', 'new.png'), 'old-new-output');

  fs.writeFileSync(path.join(TEST_ROOT, 'SRC_PNG.json'), JSON.stringify({ files: [] }));

  const ignoreSet = new Set(['ignored.png']);
  const result = tool.syncSourceToWorkDirs(TEST_ROOT, sourceDir, ['.png'], ignoreSet);

  // new.png should be copied and in changedFiles
  assert.strictEqual(result.changedFiles.includes('new.png'), true);
  // ignored.png should NOT be in changedFiles
  assert.strictEqual(result.changedFiles.includes('ignored.png'), false);
  // ignored.png should be deleted from OUT_PNG
  assert.strictEqual(fs.existsSync(path.join(TEST_ROOT, 'OUT_PNG', 'ignored.png')), false);
});

test('loadIgnoreList returns a Set of paths from JSON file', () => {
  const ignorePath = path.join(TEST_ROOT, 'ignore.json');
  fs.writeFileSync(ignorePath, JSON.stringify({ ignore: ['a.png', path.join('nested', 'b.jpg')] }));

  const set = tool.loadIgnoreList(ignorePath);

  assert.strictEqual(set.has('a.png'), true);
  assert.strictEqual(set.has(path.join('nested', 'b.jpg')), true);
  assert.strictEqual(set.size, 2);
});

test('loadIgnoreList returns empty Set when file is missing', () => {
  const set = tool.loadIgnoreList(path.join(TEST_ROOT, 'nonexistent.json'));
  assert.strictEqual(set.size, 0);
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
