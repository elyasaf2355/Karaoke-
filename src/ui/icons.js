/** Small stroke icons for the navigation. Plain SVG strings, no dependencies. */
const wrap = (paths) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  tuner: wrap('<path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 17l4-6"/><circle cx="12" cy="17" r="1.2"/>'),
  song: wrap('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  karaoke: wrap('<rect x="4" y="3" width="10" height="18" rx="2"/><circle cx="9" cy="14.5" r="2.6"/><circle cx="9" cy="7.5" r="1"/><path d="M17.5 8.5a4.5 4.5 0 0 1 0 7M20 6a8 8 0 0 1 0 12"/>'),
};
