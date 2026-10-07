import { Compass } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Misc';

export default function NotFoundPage() {
  return (
    <EmptyState
      className="min-h-[60vh]"
      icon={<Compass className="size-6" />}
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      action={<ButtonLink to="/" variant="primary">Back to dashboard</ButtonLink>}
    />
  );
}
