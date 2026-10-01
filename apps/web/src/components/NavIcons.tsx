import type { ReactNode } from 'react';

/**
 * Sidebar icons: one consistent set of 24px line icons drawn in the text
 * colour (no icon library; works offline and follows the theme).
 */
const PATHS = {
  home: (
    <>
      <path d="M4 11l8-6.5 8 6.5" />
      <path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  assets: (
    <>
      <path d="M12 3.5l7.5 4v9L12 20.5l-7.5-4v-9z" />
      <path d="M4.5 7.5L12 11.5l7.5-4M12 11.5v9" />
    </>
  ),
  offline: (
    <>
      <path d="M7 18.5h9.5a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.2 9.3 4.6 4.6 0 0 0 7 18.5z" />
      <path d="M12 10.5v5M9.8 13.4L12 15.6l2.2-2.2" />
    </>
  ),
  custody: (
    <>
      <path d="M8 4.5h8a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z" />
      <path d="M10 9h4M10 12.5h4" />
      <path d="M9.6 16.6l1.4 1.2 2.6-2.8" />
    </>
  ),
  returns: (
    <>
      <path d="M9 7.5H15a4.5 4.5 0 0 1 0 9H8" />
      <path d="M11.5 4.5L8.5 7.5l3 3" />
    </>
  ),
  transfers: (
    <>
      <path d="M5 8h13M15 5l3 3-3 3" />
      <path d="M19 16H6M9 13l-3 3 3 3" />
    </>
  ),
  inventory: (
    <>
      <path d="M9 4.5h6v2.5H9z" />
      <path d="M8 5.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-13a1 1 0 0 0-1-1H16" />
      <path d="M8.8 13.3l2 2 4.4-4.4" />
    </>
  ),
  maintenance: <path d="M14.5 5.2a4 4 0 0 0-5 5L4.8 15a1.8 1.8 0 0 0 2.6 2.6l4.7-4.7a4 4 0 0 0 5-5l-2.4 2.4-2.1-.5-.5-2.1z" />,
  sales: (
    <>
      <path d="M4.5 12.3V5.5a1 1 0 0 1 1-1h6.8l7.2 7.2a1.4 1.4 0 0 1 0 2l-5.8 5.8a1.4 1.4 0 0 1-2 0z" />
      <circle cx="8.5" cy="8.5" r="1.3" />
    </>
  ),
  reports: (
    <>
      <path d="M4.5 19.5h15" />
      <path d="M7 16v-4M11 16V8M15 16v-6M19 16V5.5" />
    </>
  ),
  dashboard: (
    <>
      <rect x="4" y="4" width="7" height="8" rx="1" />
      <rect x="13" y="4" width="7" height="5" rx="1" />
      <rect x="13" y="11" width="7" height="9" rx="1" />
      <rect x="4" y="14" width="7" height="6" rx="1" />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.5 19a6 6 0 0 1 12 0" />
      <path d="M15.5 5.6a3 3 0 0 1 0 5.8M18 14.6a5.5 5.5 0 0 1 2.5 4.4" />
    </>
  ),
  roles: (
    <>
      <path d="M12 3.8l7 2.7v5.2c0 4.3-3 7.5-7 8.6-4-1.1-7-4.3-7-8.6V6.5z" />
      <path d="M9.2 12l2 2 3.8-3.8" />
    </>
  ),
  categories: (
    <>
      <path d="M12 4l8 4-8 4-8-4z" />
      <path d="M4 12l8 4 8-4M4 16l8 4 8-4" />
    </>
  ),
  locations: (
    <>
      <path d="M12 20.5s-6-5.4-6-10.2a6 6 0 0 1 12 0c0 4.8-6 10.2-6 10.2z" />
      <circle cx="12" cy="10.2" r="2.2" />
    </>
  ),
  external: (
    <>
      <rect x="4" y="7.5" width="16" height="11.5" rx="1.5" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M4 12.5h16" />
    </>
  ),
  settings: (
    <>
      <path d="M4.5 7h9M17.5 7h2M4.5 12h3M11.5 12h8M4.5 17h7M15.5 17h4" />
      <circle cx="15.5" cy="7" r="2" />
      <circle cx="9.5" cy="12" r="2" />
      <circle cx="13.5" cy="17" r="2" />
    </>
  ),
  audit: (
    <>
      <path d="M7 3.8h7l4 4v11.4a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1z" />
      <path d="M14 3.8v4h4M9 12h6M9 15.5h6" />
    </>
  ),
  security: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.3v2.4" />
    </>
  ),
  notifications: (
    <>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  sessions: (
    <>
      <rect x="3" y="4.5" width="13" height="10" rx="1.5" />
      <path d="M7 18.5h5" />
      <rect x="17" y="9" width="4" height="10.5" rx="1" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type NavIconName = keyof typeof PATHS;

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
