import React from "react";
const paths = {
  leetcode: "M13.483 0a1.374 1.374 0 0 0-.961.438L7.116 6.226l-3.854 4.126a5.266 5.266 0 0 0-1.209 2.104 5.35 5.35 0 0 0-.125.513 5.527 5.527 0 0 0 .062 2.362 5.83 5.83 0 0 0 .349 1.017 5.938 5.938 0 0 0 1.271 1.818l4.277 4.193.039.038c2.248 2.165 5.852 2.133 8.063-.074l2.396-2.392c.54-.54.54-1.414.003-1.955a1.378 1.378 0 0 0-1.951-.003l-2.396 2.392a3.021 3.021 0 0 1-4.205.038l-.02-.019-4.276-4.193c-.652-.64-.972-1.469-.948-2.263a2.68 2.68 0 0 1 .066-.523 2.545 2.545 0 0 1 .619-1.164L9.13 8.114c1.058-1.134 3.204-1.27 4.43-.278l3.501 2.831c.593.48 1.461.387 1.94-.207a1.384 1.384 0 0 0-.207-1.943l-3.5-2.831c-.8-.647-1.766-1.045-2.774-1.202l2.015-2.158A1.384 1.384 0 0 0 13.483 0zm-2.866 12.815a1.38 1.38 0 0 0-1.38 1.382 1.38 1.38 0 0 0 1.38 1.382H20.79a1.38 1.38 0 0 0 1.38-1.382 1.38 1.38 0 0 0-1.38-1.382z",
  tests: "M8 4h12v16H4V8M3 4l2 2 4-4M8 10h8M8 15h5",
  add: "M12 5v14M5 12h14",
  more: "M5 11v2M12 11v2M19 11v2",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 3h4l.7 2.4 2 .9 2.3-.6 2 3.4-1.6 1.8v2.2l1.6 1.8-2 3.4-2.3-.6-2 .9L14 22h-4l-.7-2.4-2-.9-2.3.6-2-3.4L4.6 14v-2.2L3 10l2-3.4 2.3.6 2-.9L10 3",
  check: "m5 12 4 4L19 6",
  attempt: "M12 4a8 8 0 1 0 8 8M12 7v6l4 2",
  lock: "M6 10h12v11H6Zm3 0V6a3 3 0 0 1 6 0v4",
  previous: "m15 5-7 7 7 7",
  chevron: "m9 5 7 7-7 7",
  close: "M6 6l12 12M18 6 6 18",
  play: "m8 5 11 7-11 7Z",
  pause: "M8 5v14M16 5v14",
  stop: "M6 6h12v12H6Z",
  next: "M4 11a8 8 0 0 1 14-5l2 3M16 9h4V5M12 16v4",
  into: "M12 3v12m-5-5 5 5 5-5M6 20h12",
  out: "M12 16V4m-5 5 5-5 5 5M6 20h12",
  breakpoint: "M6 12a6 6 0 1 0 12 0 6 6 0 0 0-12 0M12 8v8M8 12h8",
  refresh: "M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5",
  panel: "M3 4h18v16H3ZM8 4v16",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6",
  link: "m10 14 4-4M9 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M15 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  edit: "m15 4 5 5M4 20l4-1L21 6l-4-4L4 15Z",
  file: "M5 3h9l5 5v13H5Zm9 0v5h5M8 12h8M8 16h6",
  terminal: "m4 6 6 6-6 6M13 18h7",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  history: "M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v6l4 2",
  type: "M4 5h16M12 5v15M8 20h8",
  bug: "M8 9h8v8a4 4 0 0 1-8 0V9Zm1 0V7a3 3 0 0 1 6 0v2M3 11h5M16 11h5M3 17h5M16 17h5M6 4l3 3M18 4l-3 3",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7v1",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} fill={name === "leetcode" ? "currentColor" : "none"} stroke={name === "leetcode" ? "none" : "currentColor"} /></svg>;
}
export function IconButton({ icon, label, shortcut, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; shortcut?: string }) {
  return <button {...props} className={["icon-button",props.className].filter(Boolean).join(" ")} aria-label={label} title={props.title ?? (label + (shortcut ? " · " + shortcut : ""))}><Icon name={icon} /></button>;
}
