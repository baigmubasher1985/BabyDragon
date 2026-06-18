// Example only. Use this snippet inside your existing RF KPI/Data Test page.
// Keep this small and connect it to your current state names.

import { runFtpTest, cancelFtpTest, FTP_PRESETS } from './tests/ftp/ftpRunner';

export async function startBabyDragonFtpExample({
  activeTask,
  selectedFtpConfig,
  setFtpStatus,
  setFtpProgress,
  setFtpResult,
  appendSessionTestResult,
}) {
  const config = {
    ...FTP_PRESETS.rebexDownloadDemo,
    ...selectedFtpConfig,
    sessionId: `bd-ftp-${Date.now()}`,
    taskName: activeTask?.task_name || activeTask?.title || '',
    gridId: activeTask?.grid_id || activeTask?.gridId || '',
  };

  setFtpStatus('CONNECTING');

  const result = await runFtpTest(config, {
    onProgress: (progress) => {
      setFtpProgress(progress);
      setFtpStatus(progress.status || 'TESTING');
    },
  });

  setFtpResult(result);
  setFtpStatus(result.ok ? 'SAVED' : 'ERROR');

  // Store in your existing RF session object so reports can include FTP later.
  appendSessionTestResult?.({
    test_type: 'FTP',
    engine: 'native_android_ftp',
    result,
  });

  return result;
}

export async function stopBabyDragonFtpExample({ setFtpStatus }) {
  setFtpStatus('CANCELLING');
  return cancelFtpTest();
}
