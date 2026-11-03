import { createElement } from 'react';
import { CircleAlert } from 'lucide-react';

export function BankInvalidInstructionNotice() {
  return createElement(
    'section',
    { className: 'bank-unselected', role: 'alert' },
    createElement(CircleAlert, { size: 22 }),
    createElement('h2', null, 'No se puede abrir esta instrucción'),
    createElement('p', null, 'El enlace no identifica una factura e instrucción disponibles para tu empresa o red.'),
  );
}
