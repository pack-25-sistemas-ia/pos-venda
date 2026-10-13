'use client';

import { ActionButton } from '@/components/app/form-kit';
import { markNotifications } from '@/lib/pv/actions';

export const MarkAllButton = () => <ActionButton label="Marcar todas como lidas" action={() => markNotifications(null)} />;
export const MarkOneButton = ({ id }: { id: string }) => <ActionButton label="Marcar como lida" variant="ghost" action={() => markNotifications(id)} />;
