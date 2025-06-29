// File: C:\Users\Administrator\Desktop\Software\videogen\App.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import SettingsPanel from './components/SettingsPanel';
import VideoCreationPanel from './components/VideoCreationPanel';
import YouTubeUploadPanel from './components/YouTubeUploadPanel';
import { DEFAULT_SETTINGS, SCRIPT_FORMAT_TEMPLATE } from './configDefaults';
import type { AllSettings, AppView, ApiStatus, ApiStatusEntry, SettingsKey, ScriptType } from './types';

const MAX_LOG_ENTRIES = 100;
const MAX_YT_LOG_ENTRIES = 100;
const BACKEND_URL = 'http://127.0.0.1:5000';

// Access the Vite environment variable for Gemini API Key
const VITE_GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string || "";


const App: React.FC = () => {
  const [activeView, setActiveView] = useState<AppView>('create');
  const [settings, setSettings] = useState<AllSettings>(() => {
    const savedSettings = localStorage.getItem('videoGenSettings');
    try {
      return savedSettings ? JSON.parse(savedSettings) : DEFAULT_SETTINGS;
    } catch (e) {
      console.error("Failed to parse settings from localStorage", e);
      return DEFAULT_SETTINGS;
    }
  });
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    currentMessage: 'Welcome! Ready to create.',
    currentType: 'idle',
    log: [{id: crypto.randomUUID(), message: 'Application initialized.', type: 'info', timestamp: new Date() }]
  });
  const [isWorkflowRunning, setIsWorkflowRunning] = useState<boolean>(false);
  const statusPollInterval = useRef<number | null>(null);
  const [youtubeApiStatus, setYoutubeApiStatus] = useState<ApiStatus>({
    currentMessage: 'Ready for YouTube operations.',
    currentType: 'idle',
    log: [{id: crypto.randomUUID(), message: 'YouTube Uploader initialized.', type: 'info', timestamp: new Date()}]
  });
  const [isYoutubeUploadRunning, setIsYoutubeUploadRunning] = useState<boolean>(false);
  const youtubeStatusPollInterval = useRef<number | null>(null);
  useEffect(() => {
    localStorage.setItem('videoGenSettings', JSON.stringify(settings));
  }, [settings]);
  const addGenericLogEntry = useCallback((
    setLogState: React.Dispatch<React.SetStateAction<ApiStatus>>,
    message: string,
    type: ApiStatusEntry['type'],
    maxEntries: number,
    clearPreviousLog: boolean = false
  ) => {
    setLogState(prev => {
      const newLogEntry = { id: crypto.randomUUID(), message, type, timestamp: new Date() };
      const baseLog = clearPreviousLog ? [] : prev.log;
      const newLog = [newLogEntry, ...baseLog.filter(entry => entry.id !== newLogEntry.id)].slice(0, maxEntries);
      
      let nextCurrentType = prev.currentType;
      if (type === 'loading' || type === 'success' || type === 'error') {
        nextCurrentType = type;
      } else if (type === 'info' && prev.currentType !== 'loading' && prev.currentType !== 'error') {
        nextCurrentType = 'info';
      } else if (type === 'workflow' || type === 'upload_yt' || type === 'STDOUT' || type === 'STDERR') {
        if (prev.currentType === 'idle' || prev.currentType === 'info') {
          // No change, or set to info if appropriate for the specific type
        }
      }
      return { currentMessage: message, currentType: nextCurrentType, log: newLog };
    });
  }, []);

  const addLogEntry = useCallback((message: string, type: ApiStatusEntry['type'], clearPreviousLog: boolean = false) => {
    addGenericLogEntry(setApiStatus, message, type, MAX_LOG_ENTRIES, clearPreviousLog);
  }, [addGenericLogEntry]);
  const addYoutubeLogEntry = useCallback((message: string, type: ApiStatusEntry['type'], clearPreviousLog: boolean = false) => {
    addGenericLogEntry(setYoutubeApiStatus, message, type, MAX_YT_LOG_ENTRIES, clearPreviousLog);
  }, [addGenericLogEntry]);
  const fetchWorkflowStatus = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/workflow-status`);
      if (!response.ok) { console.error(`Workflow status poll failed: ${response.status}`); return; }
      const data = await response.json();
      const currentlyRunning = data.running;
      setIsWorkflowRunning(currentlyRunning);

      if (data.log && Array.isArray(data.log) && data.log.length > 0) {
        const latestFrontendLogTimestamp = apiStatus.log.length > 0 ?
          new Date(Math.max(...apiStatus.log.map(e => new Date(e.timestamp).getTime()))).toISOString() :
            new Date(0).toISOString();
        
        const newEntries = data.log
          .map((entry: any) => ({
              id: entry.id || `backend-${Math.random()}-${entry.timestamp || Date.now()}`,
              message: entry.message, type: entry.type,
              timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date()
          }))
          .filter((backendEntry: ApiStatusEntry) => new Date(backendEntry.timestamp).toISOString() > latestFrontendLogTimestamp);
        if (newEntries.length > 0) {
            addLogEntry(`Received ${newEntries.length} new log(s) from backend.`, 'info');
            newEntries.forEach(ne => addLogEntry(ne.message, ne.type));
        }
      }
      
      if (!currentlyRunning && statusPollInterval.current) {
        const hasError = apiStatus.log.some(l => l.type === 'error');
        addLogEntry(hasError ? 'Workflow finished with errors.' : 'Workflow finished successfully.', hasError ? 'error' : 'success');
        clearInterval(statusPollInterval.current);
        statusPollInterval.current = null;
      }
    } catch (error) { console.error("Error fetching workflow status:", error); }
  }, [addLogEntry, apiStatus.log]);
  useEffect(() => {
    if (isWorkflowRunning && !statusPollInterval.current) {
      addLogEntry("Workflow started, polling for status...", "loading");
      statusPollInterval.current = window.setInterval(fetchWorkflowStatus, 2000);
    }
    return () => { if (statusPollInterval.current) clearInterval(statusPollInterval.current); };
  }, [isWorkflowRunning, fetchWorkflowStatus, addLogEntry]);
  const fetchYoutubeUploadStatus = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/youtube/status`);
      if (!response.ok) { console.error(`YouTube status poll failed: ${response.status}`); return; }
      const data = await response.json();
      const currentlyRunning = data.running;
      setIsYoutubeUploadRunning(currentlyRunning);

      if (data.log && Array.isArray(data.log) && data.log.length > 0) {
        const latestFrontendLogTimestamp = youtubeApiStatus.log.length > 0 ?
          new Date(Math.max(...youtubeApiStatus.log.map(e => new Date(e.timestamp).getTime()))).toISOString() :
            new Date(0).toISOString();
        
        const newEntries = data.log
          .map((entry: any) => ({
              id: entry.id || `yt-backend-${Math.random()}-${entry.timestamp || Date.now()}`,
              message: entry.message, type: entry.type,
              timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date()
          }))
          .filter((backendEntry: ApiStatusEntry) => new Date(backendEntry.timestamp).toISOString() > latestFrontendLogTimestamp);
        if (newEntries.length > 0) {
            addYoutubeLogEntry(`Received ${newEntries.length} new YouTube log(s).`, 'info');
            newEntries.forEach(ne => addYoutubeLogEntry(ne.message, ne.type));
        }
      }

      if (!currentlyRunning && youtubeStatusPollInterval.current) {
        const hasError = youtubeApiStatus.log.some(l => l.type === 'error');
        addYoutubeLogEntry(hasError ? 'YouTube operation finished with errors.' : 'YouTube operation finished successfully.', hasError ? 'error' : 'success');
        clearInterval(youtubeStatusPollInterval.current);
        youtubeStatusPollInterval.current = null;
      }
    } catch (error) { console.error("Error fetching YouTube upload status:", error); }
  }, [addYoutubeLogEntry, youtubeApiStatus.log]);

  useEffect(() => {
    if (isYoutubeUploadRunning && !youtubeStatusPollInterval.current) {
      addYoutubeLogEntry("YouTube upload started, polling for status...", "loading");
      youtubeStatusPollInterval.current = window.setInterval(fetchYoutubeUploadStatus, 2000);
    }
    return () => { if (youtubeStatusPollInterval.current) clearInterval(youtubeStatusPollInterval.current); };
  }, [isYoutubeUploadRunning, fetchYoutubeUploadStatus, addYoutubeLogEntry]);
  const handleSettingsChange = useCallback(
    <K extends ScriptType, SK extends SettingsKey<K>>(script: K, key: SK, value: AllSettings[K][SK]) => {
      setSettings(prev => ({ ...prev, [script]: { ...prev[script], [key]: value } }));
    }, []
  );
  const handleSaveSettings = useCallback(async () => {
    addLogEntry('Saving settings...', 'loading');
    try {
      localStorage.setItem('videoGenSettings', JSON.stringify(settings));
      await new Promise(resolve => setTimeout(resolve, 300));
      addLogEntry('Settings saved locally (backend endpoint is illustrative).', 'success');
    } catch (error) {
      const errorMsg = `Error saving settings: ${error instanceof Error ? error.message : 'Unknown error'}`;
      addLogEntry(errorMsg, 'error');
    }
  }, [settings, addLogEntry]);
  const handleLoadDefaults = useCallback(() => {
    if (window.confirm("Load default settings? Unsaved changes will be lost.")) {
      setSettings(DEFAULT_SETTINGS);
      addLogEntry('Default settings loaded.', 'info');
    }
  }, [addLogEntry]);
  const handleStartWorkflow = useCallback(async (scriptContent: string, backgroundMusic?: File) => {
    addLogEntry('Preparing video generation workflow...', 'loading', true);
    setIsWorkflowRunning(true);
    const formData = new FormData();
    formData.append('scriptContent', scriptContent);
    formData.append('settings', JSON.stringify(settings));
    if (backgroundMusic) formData.append('backgroundMusic', backgroundMusic);
    try {
      const response = await fetch(`${BACKEND_URL}/api/start-workflow`, { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || `Server error: ${response.status}`);
      addLogEntry(result.message || 'Workflow started by backend.', 'workflow');
    } catch (error) {
      const errorMsg = `Error starting workflow: ${error instanceof Error ? error.message : 'Unknown error'}`;
      addLogEntry(errorMsg, 'error');
      setIsWorkflowRunning(false);
    }
  }, [settings, addLogEntry]);

  const handleStopWorkflow = useCallback(async () => {
    if (!isWorkflowRunning) { addLogEntry("Workflow not running.", "info"); return; }
    addLogEntry("Requesting to stop workflow...", "loading");
    try {
      const response = await fetch(`${BACKEND_URL}/api/stop-workflow`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || `Server error: ${response.status}`);
      addLogEntry(result.message || "Workflow stop request sent.", "info");
      setIsWorkflowRunning(false);
    } catch (error) {
      const errorMsg = `Error stopping workflow: ${error instanceof Error ? error.message : 'Unknown error'}`;
      addLogEntry(errorMsg, 'error');
    }
  }, [isWorkflowRunning, addLogEntry]);
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-gray-900 text-gray-100">
      <Sidebar activeView={activeView} onSelectView={setActiveView} />
      <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto">
        <div className="max-w-full mx-auto backdrop-blur-sm">
          {activeView === 'create' && (
            <VideoCreationPanel
              onStartWorkflow={handleStartWorkflow}
              status={apiStatus}
              isWorkflowRunning={isWorkflowRunning}
              onStopWorkflow={handleStopWorkflow}
              scriptFormatTemplate={SCRIPT_FORMAT_TEMPLATE}
              geminiApiKey={VITE_GEMINI_API_KEY} // Correctly pass the environment variable
            />
          )}
          {activeView === 'settings' && (
            <SettingsPanel
              settings={settings}
              onSettingsChange={handleSettingsChange}
              onSaveSettings={handleSaveSettings}
              onLoadDefaults={handleLoadDefaults}
            />
          )}
          {activeView === 'youtubeUpload' && (
            <YouTubeUploadPanel
              youtubeApiStatus={youtubeApiStatus}
              addYoutubeLogEntry={addYoutubeLogEntry}
              isYoutubeUploadRunning={isYoutubeUploadRunning}
              setIsYoutubeUploadRunning={setIsYoutubeUploadRunning}
              initialTags={settings.upload.tags} // Pass initialTags from settings
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default App;