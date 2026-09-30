import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { TextField } from './Form';
import { parseTyped } from './DatePicker';

function Harness({ initial = '', min, max, onValue }: { initial?: string; min?: string; max?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <TextField
        label="تاريخ الشراء"
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          setValue(e.target.value);
          onValue?.(e.target.value);
        }}
      />
      <output data-testid="value">{value}</output>
      <button type="button">خارج</button>
    </>
  );
}

describe('parseTyped', () => {
  it('accepts year-first, day-first and Arabic digits; rejects impossible dates', () => {
    expect(parseTyped('2026/09/30')).toBe('2026-09-30');
    expect(parseTyped('2026-9-3')).toBe('2026-09-03');
    expect(parseTyped('30/09/2026')).toBe('2026-09-30');
    expect(parseTyped('٣٠/٠٩/٢٠٢٦')).toBe('2026-09-30');
    expect(parseTyped('')).toBe('');
    expect(parseTyped('2026/02/30')).toBeUndefined();
    expect(parseTyped('2026/09')).toBeUndefined();
  });
});

describe('Date field', () => {
  it('shows an ISO value as 2026/09/30 and emits ISO when typed', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="2025-03-10" onValue={onValue} />);
    const input = screen.getByLabelText('تاريخ الشراء');
    expect(input).toHaveValue('2025/03/10');
    await user.clear(input);
    expect(onValue).toHaveBeenLastCalledWith('');
    await user.type(input, '31/12/2026');
    expect(screen.getByTestId('value')).toHaveTextContent('2026-12-31');
    await user.tab();
    expect(input).toHaveValue('2026/12/31');
  });

  it('marks an incomplete or impossible date without changing the value', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2025-03-10" />);
    const input = screen.getByLabelText('تاريخ الشراء');
    await user.clear(input);
    await user.type(input, '2026/02/30');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('value')).toHaveTextContent('');
  });

  it('picks a day from the calendar, with Palestinian month names and a Saturday-first week', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-09-15" />);
    await user.click(screen.getByRole('button', { name: 'فتح التقويم' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'أيلول 2026' })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('columnheader')[0]).toHaveAccessibleName('السبت');
    await user.click(within(dialog).getByRole('button', { name: 'الأربعاء 30 أيلول 2026' }));
    expect(screen.getByTestId('value')).toHaveTextContent('2026-09-30');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('تاريخ الشراء')).toHaveFocus();
  });

  it('keyboard: arrows move days (left is forward in RTL), PageDown moves a month, Enter picks, Escape closes', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-09-15" />);
    await user.click(screen.getByRole('button', { name: 'فتح التقويم' }));
    expect(screen.getByRole('button', { name: 'الثلاثاء 15 أيلول 2026' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'الأربعاء 16 أيلول 2026' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'الأربعاء 23 أيلول 2026' })).toHaveFocus();
    await user.keyboard('{PageDown}');
    expect(screen.getByRole('button', { name: 'تشرين الأول 2026' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('value')).toHaveTextContent('2026-10-23');

    await user.click(screen.getByRole('button', { name: 'فتح التقويم' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('jumps by month and year for dates long ago', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-09-15" />);
    await user.click(screen.getByRole('button', { name: 'فتح التقويم' }));
    await user.click(screen.getByRole('button', { name: 'أيلول 2026' }));
    await user.click(screen.getByRole('button', { name: '2026' }));
    await user.click(screen.getByRole('option', { name: '2019' }));
    await user.click(screen.getByRole('option', { name: 'آذار' }));
    expect(screen.getByRole('button', { name: 'آذار 2019' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'الأحد 10 آذار 2019' }));
    expect(screen.getByTestId('value')).toHaveTextContent('2019-03-10');
  });

  it('refuses days outside min/max, clears, and closes on an outside click', async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-09-15" min="2026-09-10" />);
    await user.click(screen.getByRole('button', { name: 'فتح التقويم' }));
    expect(screen.getByRole('button', { name: 'الأربعاء 9 أيلول 2026' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'خارج' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'مسح التاريخ' }));
    expect(screen.getByTestId('value')).toHaveTextContent('');
    expect(screen.getByLabelText('تاريخ الشراء')).toHaveValue('');
  });
});
