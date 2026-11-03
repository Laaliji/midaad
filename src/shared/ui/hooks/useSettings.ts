import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_SETTINGS,
  getSettings,
  onSettingsChanged,
  updateReaderSettings,
  type ReaderSettings,
  type Settings,
} from '../../settings';

/** Live settings for extension pages: optimistic updates, debounced persistence, cross-context sync. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<Partial<ReaderSettings>>({});
  const timer = useRef(0);

  useEffect(() => {
    void getSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
    return onSettingsChanged((s) => {
      if (!timer.current) setSettings(s); // ignore echoes of our own pending writes
    });
  }, []);

  function updateReader(patch: Partial<ReaderSettings>) {
    setSettings((s) => ({ ...s, reader: { ...s.reader, ...patch } }));
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const p = pending.current;
      pending.current = {};
      await updateReaderSettings(p);
      timer.current = 0;
    }, 200);
  }

  return { settings, loaded, updateReader };
}
