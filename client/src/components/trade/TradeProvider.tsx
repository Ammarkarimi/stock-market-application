import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertDialog } from './AlertDialog';
import { OrderTicket, type TicketRequest } from './OrderTicket';

interface TradeContextValue {
  openOrder: (request: TicketRequest) => void;
  openAlert: (symbol: string) => void;
}

const TradeContext = createContext<TradeContextValue | null>(null);

/** Hosts the order ticket and alert dialog so any page can open them. */
export function TradeProvider({ children }: { children: ReactNode }) {
  const [order, setOrder] = useState<(TicketRequest & { key: number }) | null>(null);
  const [alertSymbol, setAlertSymbol] = useState<string | null>(null);

  const openOrder = useCallback((request: TicketRequest) => setOrder({ ...request, key: Date.now() }), []);
  const openAlert = useCallback((symbol: string) => setAlertSymbol(symbol), []);
  const value = useMemo(() => ({ openOrder, openAlert }), [openOrder, openAlert]);

  return (
    <TradeContext.Provider value={value}>
      {children}
      {order && <OrderTicket key={order.key} request={order} onClose={() => setOrder(null)} />}
      {alertSymbol && <AlertDialog key={alertSymbol} symbol={alertSymbol} onClose={() => setAlertSymbol(null)} />}
    </TradeContext.Provider>
  );
}

export function useTrade(): TradeContextValue {
  const context = useContext(TradeContext);
  if (!context) throw new Error('useTrade must be used inside TradeProvider');
  return context;
}
