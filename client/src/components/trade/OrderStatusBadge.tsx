import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { IpoApplicationStatus, IpoStatus, OrderStatus } from '@/lib/types';

const orderTones: Record<OrderStatus, BadgeTone> = {
  OPEN: 'info',
  EXECUTED: 'success',
  CANCELLED: 'neutral',
  REJECTED: 'danger',
  EXPIRED: 'warning',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={orderTones[status]}>{status === 'EXECUTED' ? 'Executed' : status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

const ipoTones: Record<IpoStatus, BadgeTone> = {
  UPCOMING: 'primary',
  OPEN: 'success',
  CLOSED: 'warning',
  ALLOTTED: 'info',
  LISTED: 'neutral',
  WITHDRAWN: 'danger',
};

const ipoLabels: Record<IpoStatus, string> = {
  UPCOMING: 'Upcoming',
  OPEN: 'Open',
  CLOSED: 'Closed',
  ALLOTTED: 'Allotment done',
  LISTED: 'Listed',
  WITHDRAWN: 'Withdrawn',
};

export function IpoStatusBadge({ status }: { status: IpoStatus }) {
  return <Badge tone={ipoTones[status]}>{ipoLabels[status]}</Badge>;
}

const applicationTones: Record<IpoApplicationStatus, BadgeTone> = {
  APPLIED: 'info',
  CANCELLED: 'neutral',
  ALLOTTED: 'success',
  NOT_ALLOTTED: 'danger',
};

const applicationLabels: Record<IpoApplicationStatus, string> = {
  APPLIED: 'Pending allotment',
  CANCELLED: 'Cancelled',
  ALLOTTED: 'Allotted',
  NOT_ALLOTTED: 'Not allotted',
};

export function ApplicationStatusBadge({ status }: { status: IpoApplicationStatus }) {
  return <Badge tone={applicationTones[status]}>{applicationLabels[status]}</Badge>;
}
