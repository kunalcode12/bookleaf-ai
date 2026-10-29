import { type DemoAccountsResponse, PRODUCTION_STAGE_LABELS } from '@bookleaf/contracts';
import { computePayout, formatInr } from '@bookleaf/domain';
import { type DatasetAuthor, loadSampleDataset } from '@bookleaf/domain/dataset';
import type { Config } from '../config/env';

/** The BookLeaf support team seeded for the demo (fictional people, reserved .test domain). */
export const ADMIN_SEEDS = [
  { key: 'aarav', email: 'aarav.mehta@bookleaf.test', displayName: 'Aarav Mehta', title: 'Support Lead' },
  {
    key: 'isha',
    email: 'isha.verma@bookleaf.test',
    displayName: 'Isha Verma',
    title: 'Author Success Specialist',
  },
  { key: 'kabir', email: 'kabir.rao@bookleaf.test', displayName: 'Kabir Rao', title: 'Production Liaison' },
] as const;

export type AdminKey = (typeof ADMIN_SEEDS)[number]['key'];

/** One line on what makes each author an interesting persona to test with. */
function blurbFor(author: DatasetAuthor, today: Date): string {
  const books = `${author.books.length} book${author.books.length === 1 ? '' : 's'}`;
  const inProduction = author.books.find((b) => b.stage !== 'published_live');
  if (inProduction)
    return `${books} · "${inProduction.title}" in ${PRODUCTION_STAGE_LABELS[inProduction.stage]}`;
  const payouts = author.books.map((b) => ({ book: b, payout: computePayout(b, today) }));
  const below = payouts.find((p) => p.payout.status === 'below_threshold');
  if (below) return `${books} · ${formatInr(below.book.pendingMinor)} below the payout minimum`;
  const neverPaid = payouts.find((p) => p.payout.status === 'attention' && !p.book.lastPayoutDate);
  if (neverPaid) return `${books} · never received a payout`;
  const pending = author.books.reduce((sum, b) => sum + b.pendingMinor, 0);
  if (pending === 0) return `${books} · all royalties paid`;
  return `${books} · ${formatInr(pending)} pending`;
}

export function demoAccounts(config: Config, today = new Date()): DemoAccountsResponse {
  if (!config.DEMO_MODE) return { enabled: false, password: null, accounts: [] };
  return {
    enabled: true,
    password: { author: config.SEED_AUTHOR_PASSWORD, admin: config.SEED_ADMIN_PASSWORD },
    accounts: [
      ...ADMIN_SEEDS.map((a) => ({
        email: a.email,
        displayName: a.displayName,
        role: 'admin' as const,
        blurb: `${a.title} · BookLeaf team`,
      })),
      ...loadSampleDataset().map((a) => ({
        email: a.email,
        displayName: a.name,
        role: 'author' as const,
        blurb: blurbFor(a, today),
      })),
    ],
  };
}
