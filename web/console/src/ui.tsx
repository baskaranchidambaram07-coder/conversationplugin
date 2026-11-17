// Small pieces every screen of the console uses: moving to a route, and the line icons.

/** Opens a route of the console without reloading the page. */
export function go(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

/** A link that moves within the console: a real address to open in a new tab, an in-page move on a plain click. */
export function onRoute(to: string) {
  return (event: { preventDefault(): void; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    go(to);
  };
}

/** A line icon on a 24 grid, drawn in the text colour; always beside words or under an accessible name. */
export function Glyph({ path }: { path: string }) {
  return (
    <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export const ICON = {
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  home: "M3.5 10.5 12 4l8.5 6.5M5.5 9v11h13V9M10 20v-6h4v6",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0",
  out: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
};
