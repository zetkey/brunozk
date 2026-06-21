const { ipcMain, shell } = require('electron');
const simpleGit = require('simple-git');
const nodePath = require('path');
const fs = require('fs');
const { cloneGitRepository, getCollectionGitRootPath, initGit } = require('../utils/git');
const { createDirectory, removePath, exists, DEFAULT_GITIGNORE } = require('../utils/filesystem');

const toGitPath = (pathValue) => (pathValue || '').replace(/\\/g, '/');

const parseGitStatusLines = (statusRaw = '') => {
  return statusRaw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const path = line.slice(3).replace(/^"|"$/g, '');
      return { status, path };
    });
};

const getConflictFilesFromStatus = (statusRaw = '') => {
  const conflictStatuses = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

  return parseGitStatusLines(statusRaw)
    .filter(({ status }) => conflictStatuses.has(status))
    .map(({ status, path }) => ({ status, path }));
};

const getCollectionGitContext = async (collectionPath) => {
  if (!collectionPath) {
    return { isGitRepository: false };
  }

  const gitRootPath = getCollectionGitRootPath(collectionPath);
  if (!gitRootPath) {
    return { isGitRepository: false };
  }

  const git = simpleGit(gitRootPath);
  const collectionRelativePath = toGitPath(nodePath.relative(gitRootPath, collectionPath)) || '.';

  const currentGitBranch = await git.revparse(['--abbrev-ref', 'HEAD'])
    .then((branch) => branch.trim())
    .catch(() => '');

  const normalizedBranch = currentGitBranch && currentGitBranch !== 'HEAD'
    ? currentGitBranch
    : await git.raw(['symbolic-ref', '--short', 'HEAD'])
      .then((branch) => branch.trim())
      .catch(() => '')
      || await git.raw(['branch', '--show-current'])
        .then((branch) => branch.trim())
        .catch(() => '')
        || await git.branchLocal()
          .then((branches) => branches.current || '')
          .catch(() => '');

  const [gitRepoUrl, changedFilesRaw] = await Promise.all([
    git.listRemote(['--get-url', 'origin']).then((url) => url.trim()).catch(() => ''),
    git.raw(['status', '--porcelain', '--', collectionRelativePath]).catch(() => '')
  ]);

  const changedFiles = changedFilesRaw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const conflictFiles = getConflictFilesFromStatus(changedFilesRaw);

  return {
    isGitRepository: true,
    gitRootPath,
    collectionRelativePath,
    currentGitBranch: normalizedBranch,
    gitRepoUrl,
    changedFilesCount: changedFiles.length,
    hasChanges: changedFiles.length > 0,
    conflictFilesCount: conflictFiles.length,
    hasConflicts: conflictFiles.length > 0
  };
};

const getGitRemoteWebUrl = (remoteUrl = '') => {
  const trimmedRemoteUrl = remoteUrl.trim().replace(/\.git$/, '');

  if (!trimmedRemoteUrl) {
    return '';
  }

  const scpLikeMatch = trimmedRemoteUrl.match(/^git@([^:]+):(.+)$/);
  if (scpLikeMatch) {
    return `https://${scpLikeMatch[1]}/${scpLikeMatch[2]}`;
  }

  const sshMatch = trimmedRemoteUrl.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  if (/^https?:\/\//.test(trimmedRemoteUrl)) {
    return trimmedRemoteUrl;
  }

  return '';
};

const buildMergeRequestUrl = ({ gitRepoUrl, currentGitBranch }) => {
  const webUrl = getGitRemoteWebUrl(gitRepoUrl);
  if (!webUrl) {
    throw new Error('Cannot build merge request URL because origin remote is not configured.');
  }

  if (!currentGitBranch || currentGitBranch === 'HEAD') {
    throw new Error('Cannot build merge request URL because the current branch could not be detected.');
  }

  const encodedBranch = encodeURIComponent(currentGitBranch);

  if (webUrl.includes('gitlab.')) {
    return `${webUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodedBranch}`;
  }

  if (webUrl.includes('github.')) {
    return `${webUrl}/compare/${encodedBranch}?expand=1`;
  }

  throw new Error('Merge request URL is supported only for GitLab/GitHub remotes.');
};

const registerGitIpc = (mainWindow) => {
  ipcMain.handle('renderer:clone-git-repository', async (event, { url, path, processUid }) => {
    let directoryCreated = false;
    try {
      await createDirectory(path);
      directoryCreated = true;
      await cloneGitRepository(mainWindow, { url, path, processUid });
      return 'Repository cloned successfully';
    } catch (error) {
      if (directoryCreated && await exists(path)) {
        try {
          await removePath(path);
        } catch (cleanupError) {
          console.error('Failed to clean up cloned repository directory:', cleanupError);
        }
      }
      throw error;
    }
  });

  ipcMain.handle('renderer:get-collection-git-menu-state', async (event, { collectionPath }) => {
    return getCollectionGitContext(collectionPath);
  });

  ipcMain.handle('renderer:init-collection-git', async (event, { collectionPath }) => {
    if (!collectionPath) {
      throw new Error('Collection path is required to initialize Git.');
    }

    const gitRootPath = nodePath.resolve(collectionPath);
    console.debug('[git] init-collection-git: starting init for', collectionPath, '->', gitRootPath);
    await initGit(gitRootPath);

    const gitignorePath = nodePath.join(gitRootPath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      try {
        await fs.promises.writeFile(gitignorePath, DEFAULT_GITIGNORE, 'utf8');
      } catch (err) {
        console.error('[git] Failed to write .gitignore:', err);
      }
    }

    const context = await getCollectionGitContext(collectionPath).catch((err) => {
      console.error('[git] Error fetching git context after init:', err);
      return null;
    });
    console.debug('[git] init-collection-git: result', context && context.currentGitBranch ? { branch: context.currentGitBranch } : { context });

    return context;
  });

  ipcMain.handle('renderer:commit-collection-git', async (event, { collectionPath, message }) => {
    const trimmedMessage = (message || '').trim();
    if (!trimmedMessage) {
      throw new Error('Commit message is required.');
    }

    const context = await getCollectionGitContext(collectionPath);
    if (!context.isGitRepository) {
      throw new Error('Collection is not inside a Git repository.');
    }

    const git = simpleGit(context.gitRootPath);
    const changes = await git.raw(['status', '--porcelain', '--', context.collectionRelativePath]);
    if (!changes.trim()) {
      throw new Error('No Git changes found in this collection.');
    }

    await git.raw(['add', '--', context.collectionRelativePath]);

    const stagedChanges = await git.raw(['diff', '--cached', '--name-only', '--', context.collectionRelativePath]);
    if (!stagedChanges.trim()) {
      throw new Error('No staged changes found for this collection.');
    }

    const result = await git.raw(['commit', '-m', trimmedMessage, '--', context.collectionRelativePath]);
    return {
      message: result.trim(),
      ...await getCollectionGitContext(collectionPath)
    };
  });

  ipcMain.handle('renderer:pull-collection-git', async (event, { collectionPath }) => {
    const context = await getCollectionGitContext(collectionPath);
    if (!context.isGitRepository) {
      throw new Error('Collection is not inside a Git repository.');
    }

    if (!context.gitRepoUrl) {
      throw new Error('Cannot pull because origin remote is not configured.');
    }

    if (!context.currentGitBranch || context.currentGitBranch === 'HEAD') {
      throw new Error('Cannot pull because the current branch could not be detected.');
    }

    const git = simpleGit(context.gitRootPath);
    const result = await git.raw(['pull', '--no-rebase', 'origin', context.currentGitBranch]);
    return {
      message: result.trim(),
      ...await getCollectionGitContext(collectionPath)
    };
  });

  ipcMain.handle('renderer:push-collection-git', async (event, { collectionPath }) => {
    const context = await getCollectionGitContext(collectionPath);
    if (!context.isGitRepository) {
      throw new Error('Collection is not inside a Git repository.');
    }

    if (!context.gitRepoUrl) {
      throw new Error('Cannot push because origin remote is not configured.');
    }

    if (!context.currentGitBranch || context.currentGitBranch === 'HEAD') {
      throw new Error('Cannot push because the current branch could not be detected.');
    }

    const git = simpleGit(context.gitRootPath);
    const result = await git.raw(['push', '--set-upstream', 'origin', context.currentGitBranch]);
    return {
      message: result.trim(),
      ...await getCollectionGitContext(collectionPath)
    };
  });

  ipcMain.handle('renderer:get-collection-git-conflicts', async (event, { collectionPath }) => {
    const context = await getCollectionGitContext(collectionPath);
    if (!context.isGitRepository) {
      throw new Error('Collection is not inside a Git repository.');
    }

    const git = simpleGit(context.gitRootPath);
    const statusRaw = await git.raw(['status', '--porcelain', '--', context.collectionRelativePath]);
    const conflictFiles = getConflictFilesFromStatus(statusRaw);

    return {
      ...context,
      conflictFiles,
      conflictFilesCount: conflictFiles.length,
      hasConflicts: conflictFiles.length > 0
    };
  });

  ipcMain.handle('renderer:open-collection-merge-request', async (event, { collectionPath }) => {
    const context = await getCollectionGitContext(collectionPath);
    if (!context.isGitRepository) {
      throw new Error('Collection is not inside a Git repository.');
    }

    const url = buildMergeRequestUrl(context);
    await shell.openExternal(url);
    return url;
  });
};

module.exports = registerGitIpc;
