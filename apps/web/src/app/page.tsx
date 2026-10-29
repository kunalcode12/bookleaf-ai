import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/** `src/proxy.ts` normally redirects `/` first; this is the fallback when it doesn't run. */
export default async function Index() {
  const role = (await cookies()).get('bl_role')?.value;
  redirect(role === 'admin' ? '/desk' : role ? '/home' : '/login');
}
