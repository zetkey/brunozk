import React, { useEffect, useState } from 'react';
import Modal from 'components/Modal';

const GitConflictsCollection = ({ collectionPathname, onClose }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState([]);
  const [currentGitBranch, setCurrentGitBranch] = useState('');

  useEffect(() => {
    const loadConflicts = async () => {
      try {
        setIsLoading(true);
        setError('');
        const result = await window.ipcRenderer.invoke('renderer:get-collection-git-conflicts', {
          collectionPath: collectionPathname
        });
        setConflicts(result?.conflictFiles || []);
        setCurrentGitBranch(result?.currentGitBranch || '');
      } catch (err) {
        setError(err?.message || 'Could not read Git conflicts');
      } finally {
        setIsLoading(false);
      }
    };

    loadConflicts();
  }, [collectionPathname]);

  return (
    <Modal
      size="lg"
      title="Git Conflicts"
      confirmText="Close"
      hideCancel
      handleConfirm={onClose}
      handleCancel={onClose}
      dataTestId="git-conflicts-collection-modal"
    >
      <div className="text-sm">
        {isLoading ? (
          <div>Reading Git conflicts...</div>
        ) : error ? (
          <div className="text-red-500">{error}</div>
        ) : conflicts.length ? (
          <div>
            <div className="mb-3">
              Found {conflicts.length} unresolved conflict{conflicts.length === 1 ? '' : 's'}
              {currentGitBranch ? ` on ${currentGitBranch}` : ''}. Resolve these files, then commit and push again.
            </div>
            <div className="border rounded overflow-hidden">
              {conflicts.map((conflict) => (
                <div key={`${conflict.status}-${conflict.path}`} className="px-3 py-2 border-b last:border-b-0 font-mono text-xs flex gap-3">
                  <span className="opacity-70">{conflict.status}</span>
                  <span className="break-all">{conflict.path}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div>No unresolved merge conflicts were found inside this collection.</div>
            <div className="text-xs opacity-70 mt-3">
              If Push failed because the remote branch is ahead, run Fetch Up first. Conflicts are visible here only after Git creates an actual merge conflict locally.
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default GitConflictsCollection;
