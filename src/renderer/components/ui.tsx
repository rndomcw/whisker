// Small shared building blocks and class lists, so common controls look the same everywhere.
//
// When a state changes a property (say, the background of a toggled button), the class list picks one
// value or the other rather than adding an override: two utilities for the same property on one element
// win by their order in the stylesheet, not in the class attribute.

import { type JSX, splitProps } from 'solid-js';
import { Icon } from './Icon';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/** A square icon button, as in the toolbars. `on` shows it pressed (a toggle that is on). */
export function IconButton(props: ButtonProps & {
  icon: string; small?: boolean; on?: boolean;
  /** Replaces the color and hover classes, for a state of its own (such as recording). */
  tone?: string;
}) {
  const [own, rest] = splitProps(props, ['icon', 'small', 'on', 'tone', 'class']);
  return (
    <button
      {...rest}
      class={cx(
        'inline-flex flex-none items-center justify-center disabled:pointer-events-none disabled:opacity-40',
        own.small ? 'size-[22px] rounded' : 'size-7 rounded-[5px]',
        own.tone ?? (own.on ? 'bg-press text-fg' : 'text-icon hover:bg-hover active:bg-press'),
        own.class,
      )}
    >
      <Icon name={own.icon} />
    </button>
  );
}

/** A thin divider between groups of buttons. */
export function Separator(props: { vertical?: boolean }) {
  return <span class={props.vertical ? 'mx-1 h-4 w-px bg-line' : 'my-[3px] h-px w-5 bg-line'} />;
}

/** A small text toggle, such as "Cc" (match case) or ".*" (regex). */
export function TextToggle(props: { on: boolean; title: string; onClick: () => void; children: JSX.Element }) {
  return (
    <button
      title={props.title}
      onClick={() => props.onClick()}
      class={cx(
        'h-[22px] rounded border px-[5px] font-code text-[12px] font-semibold',
        props.on ? 'border-tab-active-border bg-tab-active text-fg' : 'border-transparent text-icon hover:bg-hover',
      )}
    >
      {props.children}
    </button>
  );
}

/** A text button in dialogs and cards; `primary` is the main action. */
export const textButton = (primary?: boolean) => cx(
  'inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[5px] border px-3',
  'disabled:pointer-events-none disabled:opacity-40',
  primary ? 'border-accent bg-accent text-white' : 'border-input-border bg-input text-fg hover:border-accent',
);

/** The bordered box of the device and process pickers and the query box (30px tall unless `short`). */
export const fieldBox = (short = false) => cx('flex items-center rounded-[5px] border', short ? 'h-[26px]' : 'h-[30px]');

// ----- menus -----

export type MenuKind = 'default' | 'proc' | 'help' | 'suggest';

export function menuBox(kind: MenuKind = 'default'): string {
  return cx(
    'fixed z-[100] max-h-[60vh] rounded-lg border border-menu-border bg-menu shadow-[0_6px_24px_rgba(0,0,0,.35)]',
    kind === 'proc' ? 'flex w-[460px] max-w-[90vw] flex-col overflow-hidden p-0' : 'overflow-auto p-1',
    kind === 'help' ? 'max-w-[640px]' : kind === 'proc' ? '' : 'max-w-[560px]',
    kind === 'suggest' ? 'min-w-[220px] font-mono text-[13px]' : kind === 'proc' ? '' : 'min-w-[180px]',
  );
}

/** A menu row; `group`, so its hint can follow the hover state. */
export function menuItem(state: { active?: boolean; disabled?: boolean; indent?: 'normal' | 'wide' } = {}): string {
  return cx(
    'group flex h-[26px] cursor-default items-center gap-2 whitespace-nowrap rounded pr-[10px]',
    state.indent === 'wide' ? 'pl-[10px]' : 'pl-[6px]',
    state.disabled ? 'pointer-events-none text-dim' : state.active ? 'bg-accent text-white' : 'hover:bg-accent hover:text-white',
  );
}

export const menuLabel = 'overflow-hidden text-ellipsis';

export const menuHint = (active?: boolean) => cx(
  'ml-auto pl-4',
  active ? 'text-white opacity-80' : 'text-dim group-hover:text-white group-hover:opacity-80',
);

export const menuHeader = 'pt-[6px] pr-[10px] pb-[3px] pl-[30px] text-[11px] font-semibold text-dim';

export const menuSeparator = 'mx-[2px] my-1 h-px bg-line';

// ----- capture dialogs -----

export const captureDialog = 'h-[min(860px,calc(100vh-48px))] w-[min(1100px,calc(100vw-48px))]';

export const captureStage = 'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4';

// ----- filter bar -----

/** The device and process pickers; `set` highlights a process picker with a selection. */
export const pickerButton = (set = false) => cx(
  fieldBox(),
  'flex-none gap-1.5 whitespace-nowrap pr-1.5 pl-2 text-left text-fg hover:border-accent [&.open]:border-accent',
  set ? 'border-tab-active-border bg-[color-mix(in_srgb,var(--tab-active)_55%,var(--input))]' : 'border-input-border bg-input',
);
export const pickerLabel = 'min-w-0 overflow-hidden text-ellipsis';
export const pickerSub = 'min-w-0 flex-1 overflow-hidden text-ellipsis text-dim';

/** The query box (and the shorter find box): red when the query is invalid, else highlighted while focused. */
export const queryField = (invalid = false, short = false) => cx(
  fieldBox(short),
  'gap-0.5 bg-input pr-[3px]',
  invalid
    ? 'border-error-bg shadow-[0_0_0_1px_var(--E-bg)]'
    : 'border-input-border focus-within:border-accent focus-within:shadow-[0_0_0_1px_var(--accent)]',
);
export const queryInput =
  'h-full min-w-0 flex-1 select-text border-0 bg-transparent px-1 font-mono text-[13px] text-fg outline-none placeholder:font-sans placeholder:text-dim';
