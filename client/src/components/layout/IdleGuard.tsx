import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

const IDLE_MS = 30 * 60_000;
const WARNING_MS = 60_000;
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

/** Signs the user out after 30 minutes without interaction, with a one-minute warning. */
export function IdleGuard() {
  const { logout, user } = useAuth();
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!user) return;
    const onActivity = () => {
      if (!warning) lastActivity.current = Date.now();
    };
    for (const event of EVENTS) window.addEventListener(event, onActivity, { passive: true });
    const timer = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_MS) {
        clearInterval(timer);
        setWarning(false);
        void logout().then(() => {
          toast.info('Signed out', { description: 'You were signed out after 30 minutes of inactivity.' });
        });
      } else if (idle >= IDLE_MS - WARNING_MS) {
        setWarning(true);
        setSecondsLeft(Math.ceil((IDLE_MS - idle) / 1000));
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      for (const event of EVENTS) window.removeEventListener(event, onActivity);
    };
  }, [user, logout, warning]);

  return (
    <Modal
      open={warning}
      onClose={() => {
        lastActivity.current = Date.now();
        setWarning(false);
      }}
      title="Are you still there?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => void logout()}>
            Sign out
          </Button>
          <Button
            onClick={() => {
              lastActivity.current = Date.now();
              setWarning(false);
            }}
          >
            Stay signed in
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        For your security you'll be signed out in <span className="num font-semibold text-fg">{secondsLeft}s</span> due to inactivity.
      </p>
    </Modal>
  );
}
