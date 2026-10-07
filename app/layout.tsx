import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'ERCOT Market Monitor', description: 'Public ERCOT market research: prices, forecast deviations, weather, and storage. Free official data with archived snapshots.' };
export default function Layout({children}: Readonly<{children: React.ReactNode}>) {return <html lang="en"><body>{children}</body></html>}
