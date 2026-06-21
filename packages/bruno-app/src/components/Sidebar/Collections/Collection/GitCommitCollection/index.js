import React, { useEffect, useRef, useState } from 'react';
import Modal from 'components/Modal';
import toast from 'react-hot-toast';

const GitCommitCollection = ({ collectionPathname, onClose }) => {
  const inputRef = useRef();
  const [commitMessage, setCommitMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCommit = async () => {
    const trimmedMessage = commitMessage.trim();
    if (!trimmedMessage) {
      setError('Commit message is required');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      await window.ipcRenderer.invoke('renderer:commit-collection-git', {
        collectionPath: collectionPathname,
        message: trimmedMessage
      });
      toast.success('Git commit created');
      onClose({ refreshGitState: true });
    } catch (err) {
      const message = err?.message || 'Git commit failed';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      size="md"
      title="Git Commit"
      confirmText="Commit"
      handleConfirm={handleCommit}
      handleCancel={onClose}
      confirmDisabled={isSubmitting || !commitMessage.trim()}
      dataTestId="git-commit-collection-modal"
    >
      <form className="bruno-form" onSubmit={(e) => e.preventDefault()}>
        <div>
          <label htmlFor="git-commit-message" className="block font-medium">
            Commit Message
          </label>
          <input
            id="git-commit-message"
            type="text"
            name="commitMessage"
            ref={inputRef}
            className="block textbox mt-2 w-full"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            onChange={(event) => {
              setCommitMessage(event.target.value);
              if (error) {
                setError('');
              }
            }}
            value={commitMessage}
            placeholder="Describe the collection change"
          />
          {error ? <div className="text-red-500 mt-2">{error}</div> : null}
          <div className="text-xs opacity-70 mt-3">
            Only changes under this collection folder are staged and committed.
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default GitCommitCollection;
