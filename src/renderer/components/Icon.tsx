// An icon from the SVG sprite in index.html (`<symbol id="i-…">`).

export function Icon(props: { name: string; class?: string }) {
  return <svg class={props.class}><use href={`#i-${props.name}`} /></svg>;
}
