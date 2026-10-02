// The window: title bar, filter bar, toolbar, log, mirror panel, and the popups over them.

import { onCleanup, onMount, Show } from 'solid-js';
import { settings } from '../state/settings';
import { RecBadge } from './capture/RecBadge';
import { DialogHost } from './Dialog';
import { DeviceSelector } from './filter/DeviceSelector';
import { ProcessSelector } from './filter/ProcessSelector';
import { QueryBar } from './filter/QueryBar';
import { Header } from './header/Header';
import { onKeyDown } from './keyboard';
import { FindBar } from './log/FindBar';
import { LogView } from './log/LogView';
import { EmptyState, Notice } from './log/Status';
import { MenuHost } from './Menu';
import { MirrorPanel } from './mirror/MirrorPanel';
import { Toast } from './Toast';
import { Toolbar } from './Toolbar';

export function App() {
  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });
  return (
    <>
      <Header />
      <div class="flex items-center gap-2 border-b border-border bg-panel py-1.5 pr-2 pl-2.5">
        <DeviceSelector />
        <ProcessSelector />
        <QueryBar />
      </div>
      <div class="flex min-h-0 flex-1">
        <Toolbar />
        <div class="relative flex min-w-0 flex-1 flex-col">
          <Notice />
          <FindBar />
          <RecBadge />
          <LogView />
          <EmptyState />
        </div>
        <Show when={settings.mirror}><MirrorPanel /></Show>
      </div>
      <MenuHost />
      <Toast />
      <DialogHost />
    </>
  );
}
