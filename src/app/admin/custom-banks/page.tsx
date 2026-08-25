/**
 * The platform's custom payer banks — the brands a customer can pay from that
 * Sudeban's table does not list, and the real bank each one routes to.
 *
 * A short list on purpose: there is one row today (Ubii) and there will not be
 * many. So there is no search, no filter and no pagination — the whole table is
 * the screen, and a row is clicked to edit it.
 *
 * Every value here decides where a payment question is *sent*, so the table
 * states both sides of each brand outright: what the cashier picks, and what
 * Banesco is actually asked with.
 */
import { ContentLayout } from '../../_components/content-layout.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { pageMeta } from '../../_lib/page-meta.ts';
import { CustomBanksView } from './custom-banks-view.tsx';

export const metadata = pageMeta('Bancos custom');

export default async function CustomBanksPage() {
  await requireArea('admin');
  const banks = await container().customBanks.listCustomPayerBanks();
  const active = banks.filter((bank) => bank.status === 'active').length;

  return (
    <ContentLayout
      title="Bancos custom"
      subtitle={
        banks.length === 0
          ? 'Ninguno configurado'
          : `${active} ${active === 1 ? 'activo' : 'activos'} de ${banks.length}`
      }
    >
      <CustomBanksView banks={banks} />
    </ContentLayout>
  );
}
