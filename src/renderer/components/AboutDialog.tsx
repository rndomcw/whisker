// About Whisker: version, update status, versions to include in bug reports, and links.

import { createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import type { AppInfo, UpdateStatus } from '../../shared/types';
import { api } from '../api';
import { closeDialog, openDialog } from '../state/dialog';
import { toast } from '../state/toast';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { textButton } from './ui';

const [status, setStatus] = createSignal<UpdateStatus>({ state: 'idle' });
let listening = false;

/** Opens the About dialog; `check` also checks for updates (Help → Check for Updates…). */
export function openAboutDialog(check = false): void {
  if (!listening) {
    listening = true;
    api.onUpdateStatus(setStatus);
  }
  void api.updateStatus().then(setStatus);
  if (check) api.checkForUpdates();
  openDialog(() => <AboutDialog />);
}

function timeAgo(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : new Date(ms).toLocaleDateString();
}

function UpdateRow(props: { portable: boolean }) {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(timer));

  async function install(): Promise<void> {
    if (!(await api.installUpdate())) toast('Finish or discard the recording first, then restart to update');
  }

  const checkButton = (label = 'Check for Updates') => (
    <button class={textButton()} onClick={() => api.checkForUpdates()}>{label}</button>
  );

  return (
    <div class="flex min-h-[46px] items-center gap-3 rounded-md border border-line bg-bg px-3.5 py-2">
      <div class="min-w-0 flex-1">
        <Switch>
          <Match when={status().state === 'unsupported'}>
            <div>Development build</div>
            <div class="text-[12px] text-dim">Updates are only available in the installed app.</div>
          </Match>
          <Match when={status().state === 'checking'}>
            <div>Checking for updates…</div>
          </Match>
          <Match when={status().state === 'downloading' && status() as Extract<UpdateStatus, { state: 'downloading' }>}>
            {s => (
              <>
                <div>Downloading Whisker {s().version}… {s().percent}%</div>
                <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                  <div class="h-full bg-accent transition-[width]" style={{ width: `${s().percent}%` }} />
                </div>
              </>
            )}
          </Match>
          <Match when={status().state === 'ready' && status() as Extract<UpdateStatus, { state: 'ready' }>}>
            {s => (
              <>
                <div class="text-fg">Whisker {s().version} is ready to install</div>
                <div class="text-[12px] text-dim">It installs when you restart or quit Whisker.</div>
              </>
            )}
          </Match>
          <Match when={status().state === 'available' && status() as Extract<UpdateStatus, { state: 'available' }>}>
            {s => (
              <>
                <div class="text-fg">Whisker {s().version} is available</div>
                <div class="text-[12px] text-dim">The portable app can't update itself; download the new version.</div>
              </>
            )}
          </Match>
          <Match when={status().state === 'current' && status() as Extract<UpdateStatus, { state: 'current' }>}>
            {s => (
              <>
                <div class="flex items-center gap-1.5"><Icon name="check" class="text-[#73C991]" />Whisker is up to date</div>
                <div class="text-[12px] text-dim">Checked {(now(), timeAgo(s().checkedAt))}</div>
              </>
            )}
          </Match>
          <Match when={status().state === 'error' && status() as Extract<UpdateStatus, { state: 'error' }>}>
            {s => (
              <>
                <div>Couldn't check for updates</div>
                <div class="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-error" title={s().error}>{s().error}</div>
              </>
            )}
          </Match>
          <Match when={status().state === 'idle'}>
            <div>{props.portable ? 'Portable app' : 'Automatic updates are on'}</div>
            <div class="text-[12px] text-dim">
              {props.portable ? 'New versions are downloaded from GitHub.' : 'Whisker checks GitHub every few hours.'}
            </div>
          </Match>
        </Switch>
      </div>
      <Switch fallback={checkButton()}>
        <Match when={status().state === 'checking' || status().state === 'downloading'}>{null}</Match>
        <Match when={status().state === 'unsupported'}>{null}</Match>
        <Match when={status().state === 'ready'}>
          <button class={textButton(true)} onClick={() => void install()}>Restart to Update</button>
        </Match>
        <Match when={status().state === 'available'}>
          <button class={textButton(true)} onClick={() => api.openLink('releases')}>Download</button>
        </Match>
        <Match when={status().state === 'error'}>{checkButton('Try Again')}</Match>
      </Switch>
    </div>
  );
}

function AboutDialog() {
  const [info, setInfo] = createSignal<AppInfo | null>(null);
  onMount(() => void api.appInfo().then(setInfo));

  const details = () => {
    const i = info();
    return i
      ? `Whisker ${i.version}${i.portable ? ' (portable)' : ''}\nElectron ${i.electron}\nChromium ${i.chrome}\nNode.js ${i.node}\n${i.os}`
      : '';
  };

  async function copyDetails(): Promise<void> {
    try {
      await navigator.clipboard.writeText(details());
      toast('Version details copied');
    } catch {
      toast('Copy failed');
    }
  }

  const Link = (props: { link: Parameters<typeof api.openLink>[0]; children: string }) => (
    <button class="text-accent hover:underline" onClick={() => api.openLink(props.link)}>{props.children}</button>
  );

  return (
    <Dialog
      title="About Whisker"
      class="w-[480px]"
      footer={<>
        <button class={textButton()} title="Copy the versions, for bug reports" onClick={() => void copyDetails()}>
          <Icon name="copy" />Copy Details
        </button>
        <span class="flex-1" />
        <button class={textButton(true)} onClick={closeDialog}>OK</button>
      </>}
    >
      <div class="flex select-text flex-col gap-4 bg-panel px-6 pt-6 pb-5">
        <div class="flex items-center gap-4">
          <img src="logo.svg" alt="" class="size-16 flex-none" />
          <div class="min-w-0">
            <div class="text-[22px] font-semibold leading-tight text-fg">Whisker</div>
            <div class="text-fg-2">
              Version {info()?.version ?? '…'}
              <Show when={info()?.portable}><span class="text-dim"> · portable</span></Show>
            </div>
            <div class="mt-1 text-[12px] text-dim">A desktop Android logcat viewer with screen mirroring.</div>
          </div>
        </div>

        <UpdateRow portable={!!info()?.portable} />

        <Show when={info()}>
          {i => (
            <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12px]">
              <span class="text-dim">Electron</span><span class="font-mono text-fg-2">{i().electron}</span>
              <span class="text-dim">Chromium</span><span class="font-mono text-fg-2">{i().chrome}</span>
              <span class="text-dim">Node.js</span><span class="font-mono text-fg-2">{i().node}</span>
              <span class="text-dim">OS</span><span class="font-mono text-fg-2">{i().os}</span>
            </div>
          )}
        </Show>

        <div class="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[12px]">
          <Link link="repo">GitHub</Link>
          <Link link="issues">Report an Issue</Link>
          <Link link="releases">Release Notes</Link>
          <Link link="license">MIT License</Link>
        </div>
        <div class="-mt-2 text-[11px] text-dim">
          © 2026 Wing Chu. Mirroring and recording use the scrcpy server by Genymobile (Apache-2.0).
          Not affiliated with Google.
        </div>
      </div>
    </Dialog>
  );
}
