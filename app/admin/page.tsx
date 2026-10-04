import type { Metadata } from 'next';
import AdminApp from '@/components/admin/AdminApp';

export const metadata: Metadata = { title: 'Admin · Namma Metro', robots: { index: false, follow: false } };

export default function Page() {
  return <AdminApp />;
}
