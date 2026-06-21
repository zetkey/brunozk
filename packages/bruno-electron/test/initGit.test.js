const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { initGit, getCollectionGitRootPath } = require('../src/utils/git');

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-git-test-'));
  try {
    // create a temp folder to initialize
    const repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(repoDir);

    const branch = await initGit(repoDir);
    console.log('initGit returned branch:', branch);
    assert.ok(branch && branch.length > 0, 'Branch should be created after init');

    const gitRoot = getCollectionGitRootPath(repoDir);
    console.log('getCollectionGitRootPath:', gitRoot);
    assert.ok(gitRoot, 'Should detect git root after init');

    console.log('initGit test passed');
  } catch (err) {
    console.error('initGit test failed', err);
    process.exitCode = 2;
  } finally {
    // cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
