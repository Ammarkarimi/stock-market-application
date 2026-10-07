import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, FileText, Printer } from 'lucide-react';
import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, qs } from '@/lib/api';
import { addDaysISO, formatDate, formatDateTime, formatINR, titleCase, todayIST } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { LedgerEntryType, Statement } from '@/lib/types';

type Preset = '30D' | 'MONTH' | '3M' | 'FY' | 'CUSTOM';

const TYPE_TONES: Record<LedgerEntryType, BadgeTone> = {
  DEPOSIT: 'success',
  WITHDRAWAL: 'warning',
  BUY: 'info',
  SELL: 'primary',
  CHARGES: 'neutral',
  IPO_ALLOTMENT: 'info',
  ADJUSTMENT: 'warning',
};

function presetRange(preset: Preset): { from: string; to: string } {
  const to = todayIST();
  if (preset === 'MONTH') return { from: `${to.slice(0, 8)}01`, to };
  if (preset === '3M') return { from: addDaysISO(to, -91), to };
  if (preset === 'FY') {
    const year = Number(to.slice(0, 4));
    const start = Number(to.slice(5, 7)) >= 4 ? year : year - 1;
    return { from: `${start}-04-01`, to };
  }
  return { from: addDaysISO(to, -30), to };
}

export default function StatementsPage() {
  const [preset, setPreset] = useState<Preset>('3M');
  const [custom, setCustom] = useState(presetRange('3M'));
  const [type, setType] = useState<LedgerEntryType | ''>('');
  const range = preset === 'CUSTOM' ? custom : presetRange(preset);
  const params = { from: range.from, to: range.to, type };
  const { data, isPending, error, refetch } = useQuery({
    queryKey: keys.statement(params),
    queryFn: () => api.get<Statement>(`/statements${qs(params)}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Account statement"
        description="Every credit and debit to your account with running balances."
        actions={
          <>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 text-[13px] font-medium hover:bg-surface-3" href={`/api/statements/ledger.csv${qs(params)}`}>
              <Download className="size-4" /> Statement CSV
            </a>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 text-[13px] font-medium hover:bg-surface-3" href={`/api/statements/trades.csv${qs({ from: range.from, to: range.to })}`}>
              <Download className="size-4" /> Trades CSV
            </a>
            <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
          </>
        }
      />
      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <Segmented
            aria-label="Statement period"
            size="md"
            value={preset}
            onChange={setPreset}
            options={[
              { value: '30D', label: '30 days' },
              { value: 'MONTH', label: 'This month' },
              { value: '3M', label: '3 months' },
              { value: 'FY', label: 'This FY' },
              { value: 'CUSTOM', label: 'Custom' },
            ]}
          />
          {preset === 'CUSTOM' && (
            <>
              <Input label="From" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <Input label="To" type="date" value={custom.to} min={custom.from} max={todayIST()} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </>
          )}
          <Select label="Entry type" value={type} onChange={(e) => setType(e.target.value as LedgerEntryType | '')} containerClassName="w-44">
            <option value="">All entries</option>
            {(Object.keys(TYPE_TONES) as LedgerEntryType[]).map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </Select>
        </CardBody>
      </Card>

      {isPending ? (
        <PageLoader />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={`Opening balance · ${formatDate(data.from)}`} value={formatINR(data.openingBalance)} />
            <Stat label="Total credits" value={<span className="text-gain">+{formatINR(data.totalCredits)}</span>} />
            <Stat label="Total debits" value={<span className="text-loss">−{formatINR(data.totalDebits)}</span>} />
            <Stat label={`Closing balance · ${formatDate(data.to)}`} value={formatINR(data.closingBalance)} />
          </div>
          <Card>
            <CardHeader
              title="Ledger"
              subtitle={`${data.entries.length} entr${data.entries.length === 1 ? 'y' : 'ies'} from ${formatDate(data.from)} to ${formatDate(data.to)}`}
              action={
                <div className="hidden flex-wrap justify-end gap-2 md:flex">
                  {Object.entries(data.totalsByType).map(([key, value]) => (
                    <span key={key} className="num rounded-md bg-surface-2 px-2 py-1 text-xs">
                      <span className="text-muted">{titleCase(key)}</span> {formatINR(value, { decimals: 0, sign: true })}
                    </span>
                  ))}
                </div>
              }
            />
            {data.entries.length === 0 ? (
              <EmptyState icon={<FileText className="size-6" />} title="No entries in this period" />
            ) : (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Description</Th>
                      <Th className="hidden sm:table-cell">Type</Th>
                      <Th align="right">Debit</Th>
                      <Th align="right">Credit</Th>
                      <Th align="right">Balance</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((entry) => (
                      <Tr key={entry.id}>
                        <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(entry.createdAt)}</Td>
                        <Td className="max-w-md">{entry.description}</Td>
                        <Td className="hidden sm:table-cell"><Badge tone={TYPE_TONES[entry.type]}>{titleCase(entry.type)}</Badge></Td>
                        <Td align="right" className="text-loss">{entry.debit ? formatINR(entry.debit) : ''}</Td>
                        <Td align="right" className="text-gain">{entry.credit ? formatINR(entry.credit) : ''}</Td>
                        <Td align="right" className="font-medium">{formatINR(entry.balanceAfter)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
